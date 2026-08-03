# Project: Agent Observability

> 项目级约定与总览。各模块行为规格见 `specs/<domain>/spec.md`。
> **类型、DDL、API、性能预算四份契约见 `contracts/`，它们是 codegen 的权威输入。**
> 避坑核心见 `gotchas.md`。

## 1. 项目定位

本地 Web UI，用于查看、分析、对比 AI 编码助手（Claude Code / Codex / OpenCode / CodeArts / CodeAgent / Trae CN / Qoder / WorkBuddy）的会话轨迹。

核心价值主张：**快 · 准 · 稳 · 省** 四维度衡量 Agent 质量。

| 维度 | 指标 |
|------|------|
| 快 | TTFT / TPS / TPOT / 端到端时延 / avgToolDurationMs |
| 准 | verificationCoverage（是否有 test 运行） |
| 稳 | errorRate / enteredDebug |
| 省 | tokensPerStep / costUsd |

两种数据来源：**Scan**（读本地会话文件）与 **Proxy**（MITM + CDP + Frida 实时捕获），二者在 UI 上分开展示。

## 2. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 运行时 | Node.js ≥ 20 | 硬性要求 |
| 语言 | TypeScript ~6.0.2 | `verbatimModuleSyntax`、`erasableSyntaxOnly`、strict |
| 前端 | React 19.2 + Vite 8 | SPA，无路由库 |
| 后端 | 纯 Node HTTP server | 不用 Express/Fastify |
| 存储 | better-sqlite3（WAL，schema v1） | 原生模块，Windows 需 MSVC；全新库，无迁移 |
| 文件监视 | chokidar 5 | 300ms debounce；db 类 provider 走 30s 轮询 |
| MITM | http-mitm-proxy 1.1 | HTTPS CONNECT + per-domain 证书 |
| 加密 | node-forge 1.4 | CA 生成（OpenSSL 不可用时兜底） |
| 压缩 | node:zlib | 响应 gzip，不引第三方 |
| 测试 | Vitest 3 | jsdom env、globals、colocated `*.test.ts` |
| Lint | ESLint 10 flat config | |

依赖极少（4 个 runtime 依赖 + 可选的前端虚拟滚动库），刻意保持轻量。

## 3. 架构总览

### 3.1 单向数据流

```
Raw vendor JSONL / SQLite / SQLCipher
  → 增量门禁 (scan_state 指纹)   ← 未变更即在此终止，零 IO 零 SQL
  → Scanner (local-sessions/)     产出 SessionIndexEntry
  → Adapter (src/adapters/)       原始数据 → TraceRecord（slim / 正文 / raw 三部分分离）
  → Storage (server/storage/)     sessions + events + event_raw + metrics
  → Core (src/core/)              phase 分类 / 指标 / 报告
  → UI (src/components/)          Gantt 树 / 详情面板 / 对比板
```

### 3.2 双数据源

```
scan  ：chokidar 或 30s 轮询 → 增量门禁 → scan-scheduler → SQLite → SSE(合并) → UI
proxy ：MITM / CDP / Frida  → 脱敏 → proxy-writer → SQLite → SSE(节流) → UI
```

### 3.3 三条不可违背的架构原则

这三条是 v4 全部性能问题的根源，v5 把它们提升为架构约束：

1. **不做无用功** —— 任何读取、解析、写入前，先问「上次之后变了吗」。答案是「没变」时的正确行为是**立即返回**，不是「快速地重做一遍」。
2. **不在请求路径上做重活** —— 同步文件 IO、子进程 spawn、全表聚合都不得出现在 HTTP handler 里。未就绪就返回 `pending: true`，让后台补齐 + SSE 通知。
3. **传输量按需分级** —— 列表不带正文，详情不带 raw，正文点开才拉。数据的默认可见性是「不返回」，需要哪一档显式声明。

## 4. 目录结构

```
agent-observability-main/
├── server/
│   ├── server.ts              # createAgentObservabilityServer() + 全部 API 路由
│   ├── cli.ts                 # CLI 入口
│   ├── http/                  # send-json（含 gzip）+ error-envelope + 路由匹配
│   ├── proxy/                 # MITM + CDP + Frida + CA + parsers
│   ├── storage/               # schema + writers + query-engine
│   │                          #   + detail-cache（LRU）+ overview（聚合）+ session-merge
│   ├── realtime/              # TypedEventBus + coalescer（200ms 合并）+ SSE + frontline
│   ├── watch/                 # fingerprint + scan-gate + chokidar + poll + scan-scheduler
│   └── desensitization/       # PII 脱敏引擎
├── local-sessions/            # 9 个扫描器 + config + trae-bridge + vite-plugin(dev)
├── src/
│   ├── App.tsx                # 单 stateful shell，5 视图
│   ├── adapters/              # 9 个 provider 适配器 + sample-loader
│   ├── core/                  # trace-types + phase-classifier + metrics + speed + report
│   ├── components/            # ~20 个 React 组件（列表与 Gantt 均虚拟滚动）
│   ├── i18n/                  # zh/en 双语（含错误码文案）
│   └── generated/             # 机器生成，勿手改
├── config/                    # session-groups.json (gitignored) + *.example.json
├── scripts/                   # generate-local-samples + pack-binary + trae-* + frida-*
├── perf-diag/                 # 7 个性能诊断脚本（回归基线工具，随仓库保留）
├── bin/agent-observe.js
└── openspec/                  # 本规格
    ├── contracts/             # ← codegen 权威输入
    └── specs/
```

## 5. 构建三阶段

```
npm run build = tsc -b && vite build && vite build --config vite.cli.config.ts
```

顺序不可颠倒；server-dist 的外部依赖不打包。

## 6. 约定

- 测试与源码同目录（`*.test.ts`），不放 `__tests__/`
- i18n 新增字符串必须同时加 `en` 和 `zh`
- `src/generated/` 机器生成，改 generator 不改输出
- config 三层覆盖：内置默认 → `config/local-sessions.local.json`（gitignored）→ 用户配置
- 路径展开支持 `~`、`~\`、`%VAR%`
- 不上传 `captured-prompts/`、`captures/`、`compare/`、`*.log` 到 git
- 所有对外时间戳为 ISO 8601 UTC 字符串
- 所有非 2xx 响应用统一 `ApiError` 信封

## 7. Provider 适配矩阵

| Provider | 输入源 | sourceKind | 监视 | Scanner | Adapter | cacheRead 语义 | 特殊处理 |
|----------|--------|-----------|------|---------|---------|---------------|---------|
| Claude Code | JSONL | jsonl | chokidar | claude.ts | claude-code.ts | incremental | — |
| Codex | JSONL | jsonl | chokidar | codex.ts | codex.ts | incremental | 读 session_index.jsonl + state_5.sqlite 取 title |
| OpenCode | SQLite+JSONL+OTel | sqlite | poll | opencode.ts | opencode.ts | **cumulative** | dialect 参数，被复用 |
| CodeArts | SQLite | sqlite | poll | codearts.ts | 复用 opencode | **cumulative** | thin wrapper |
| CodeAgent 2.0 | SQLite | sqlite | poll | codeagent2.ts | 复用 opencode | **cumulative** | thin wrapper |
| CodeAgent 3.0 | JSONL | jsonl | chokidar | codeagent.ts | codeagent.ts | incremental | 包装 claude-code，drop file-history-snapshot |
| Trae CN | SQLCipher | sqlcipher | poll | trae.ts | trae.ts | incremental | 需 python key；token_usage /2；异步解密 |
| Qoder | JSONL | jsonl | chokidar | (config only) | qoder.ts | incremental | 默认禁用 |
| WorkBuddy | JSONL+SQLite | jsonl | chokidar | workbuddy.ts | workbuddy.ts | incremental | function_call≠tool_use |

## 8. 规模定档

按 **B 档**设计（实测基线：524 会话 / 73,588 event / 源文件 800MB / 单会话最大 9,590 event）。
设计上界与跳级信号见 `contracts/nfr.md` §1 与 §7。
