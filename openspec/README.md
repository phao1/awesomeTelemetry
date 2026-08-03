# OpenSpec — Agent Observability 复刻规格 v5

本目录是用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 格式编写的项目规格。

**本次为 0-1 全新构建**：不迁移任何历史数据，schema 从 v1 起，无兼容负担。
目标是复刻参考实现的全部能力，同时从第一行代码就避开它踩过的坑。

> 文中「参考实现」指被复刻的那个项目。标注了实测数字的地方，是**不这么做会长成的样子**，
> 不是本项目的现状。

## 相对参考实现规格的三个变化

1. **新增 `contracts/` 目录** —— 类型、DDL、API、性能预算四份契约。这是 v4 最大的缺口：v4 的 REQ 只说"MUST 包含 id、kind、phase"，没给类型、可空性、枚举全集，导致 codegen 时 9 个 adapter 各编各的字段。
2. **性能成为硬需求** —— v4 整份 spec 没有一条性能需求，结果复刻出的系统首屏 5.9–12.4 秒。v5 的 `contracts/nfr.md` 把预算写成可验证断言，进 CI。
3. **gotchas 增加第 11 章** —— 19 条性能类踩坑，全部有实测数字支撑。两条 v4 的原结论（G5.3 指标不持久化、G10.1 预热非阻塞）被实测推翻，已在原位标注。

## 目录结构

```
openspec/
├── README.md                    ← 你在这里
├── project.md                   ← 项目总览、技术栈、架构、约定
├── gotchas.md                   ← ⚠️ 全部踩坑汇总（第 11 章为性能类，必读）
├── contracts/                   ← ⚠️ codegen 的权威输入，冲突时以此为准
│   ├── data-model.md            ← 完整 TypeScript 类型 + 枚举全集
│   ├── database.md              ← 完整 SQL DDL v1 + 索引 + PRAGMA
│   ├── api.md                   ← 完整 HTTP API 契约 + 错误信封 + 契约测试
│   └── nfr.md                   ← 性能预算 + CI 断言 + 跳级信号
└── specs/
    ├── trace-model/             ← 数据模型行为需求
    ├── storage/                 ← SQLite 存储行为需求
    ├── session-scanning/        ← 扫描器 + 增量门禁 + 预热策略
    ├── adapters/                ← 9 provider 适配器
    ├── realtime/                ← EventBus + 事件合并 + SSE
    ├── frontend/                ← React SPA（5 视图 + 虚拟滚动）
    ├── desensitization/         ← PII 脱敏引擎
    ├── metrics-analysis/        ← phase 分类 + 四维指标 + 报告
    ├── proxy-capture/           ← MITM + CDP + Frida
    ├── trae-decryption/         ← ⚠️ Trae CN 三层解密（最耗时的逆向成果）
    ├── session-merge/           ← 会话合并
    └── cli-build/               ← CLI + 三阶段构建 + 脚本
```

## 如何用这份 spec 复刻

### 第 0 步：读四份文件
按顺序读 `contracts/data-model.md` → `contracts/database.md` → `contracts/nfr.md` → `gotchas.md` 第 11 章。
前两份决定你写出来的代码能不能拼起来，后两份决定它跑起来快不快。

**开发流程与提示词见仓库根的 `BOOTSTRAP.md` 与 `PROMPTS.md`。**

### 第 1 步：按依赖顺序实现

| 阶段 | 模块 | 依赖 | 关键契约 |
|------|------|------|---------|
| 1 | trace-model | 无 | `contracts/data-model.md` 全文 |
| 2 | storage | 1 | `contracts/database.md` 全文 |
| 3 | session-scanning | 2 | nfr §3 启动行为 |
| 4 | adapters | 1 | data-model §2 token 语义 |
| 5 | realtime | 2 | data-model §10 BusEvents |
| 6 | frontend shell | 1,5 | `contracts/api.md` §1–3 |
| 7 | desensitization | 无 | — |
| 8 | proxy-capture | 2,5,7 | api §4 |
| 9 | metrics-analysis | 1 | data-model §6 |
| 10 | session-merge | 2 | — |
| 11 | trae-decryption | 3,8 | specs/trae-decryption 全文 |
| 12 | cli-build | 全部 | api §0 + nfr §5 |

逐里程碑的文件清单与验收标准见 `BOOTSTRAP.md`。

### 第 2 步：每个模块合入后跑性能断言
`contracts/nfr.md` §5 的断言必须在 CI 中执行。它们锁住的是最容易被无意破坏的点。

### 每个 spec 的结构
- **Purpose** — 这个模块干什么
- **Requirements** — `REQ-XXX` 编号的行为需求 + `Scenario`（GIVEN/WHEN/THEN 可验证示例）
- **Gotchas** — 该模块专属踩坑，指向 `gotchas.md` 对应条目

## 最容易踩的 8 个坑（复刻前必看）

| # | 条目 | 一句话 |
|---|------|--------|
| 1 | **G11.5** | `scan_state` 写入必须抛错不能静默失败，否则增量扫描形同虚设且完全无声 |
| 2 | **G11.9** | 前端任何 `sessions.map(s => fetch(...))` 都是设计错误，改服务端聚合端点 |
| 3 | **G11.1** | 详情接口默认 slim，不带 raw 与正文，否则最差会话响应 32MB |
| 4 | **G11.6** | `spawnSync` 是单线程 Node 的绝对禁区，一次调用吃掉 1.5–2.3 秒 |
| 5 | **G4.4** | OpenCode/CodeArts 的 cache.read 是累积值用 max，reasoning 用 sum |
| 6 | **G11.15** | WAL 型数据源的变更指纹必须覆盖 `-wal` 文件，只看主 DB 永远判定未变更 |
| 7 | **G11.4** | `WHERE x=? ORDER BY y` 需要 `(x,y)` 复合索引，单列索引会产生临时排序 |
| 8 | **G3.1** | dev URL 必须 `127.0.0.1` 不是 `localhost`（华为代理 ProxyOverride） |

## 性能定位方法论

如果复刻出的系统还是慢，**不要凭直觉优化**。按 `PERF-DIAGNOSIS.md` 的 7 步流程实测：

1. 数据规模基线 → 2. 索引与查询计划 → 3. 服务端分段耗时 → 4. **A/B 对照实验** → 5. CPU profile → 6. 前端瀑布 → 7. 写入放大

第 4 步信息量最大成本最低：关掉某个可疑组件，对比前后。本项目正是靠它一步锁定根因（比值 1240 倍），而如果一上来就去优化 SQL，会在只占 4.2% CPU 的地方花掉全部时间。

## Trae 解密专题

Trae CN 三层加密（SQLCipher DB + TTNet 网络 + 客户端组装 prompt）是本项目最耗时的逆向工程。完整链路见 `specs/trae-decryption/spec.md`，含无效方案清单（**已验证 0 事件的方案不要重试**）。
v5 只改变了它的**调用方式**（异步 spawn + 结果缓存 + 移出请求路径），解密逻辑本身完全保留。

## 与 OpenSpec 工具的关系

本目录遵循 `specs/<domain>/spec.md` 约定（Requirements + Scenarios）。因目标是"复刻已有项目"而非"变更管理"，未使用 `changes/` 目录。`project.md`、`gotchas.md`、`contracts/` 是复刻导向 spec 额外加的三类文档，也是它区别于普通 OpenSpec 的核心。

如需用 OpenSpec CLI 管理：`npm install -g @fission-ai/openspec` → `openspec list`。
