# START HERE

0-1 复刻 Agent Observability 的全套开发资料。

## 交付物

| 文件 / 目录 | 用途 | 谁读 |
|------------|------|------|
| **`AGENTS.md`** | agent 常驻指令：十条禁令、五条必做、遇歧义怎么办 | **放仓库根，codex 自动读** |
| **`BOOTSTRAP.md`** | M0–M12 十三个里程碑：读什么、产出什么、怎么验收 | 你 + agent |
| **`PROMPTS.md`** | 可直接粘贴的提示词库（含模型分工与上下文加载策略） | 你 |
| `scaffold/` | M0 脚手架，14 个配置文件，拷进空仓库即可 | 你 |
| `openspec/contracts/` | 四份契约：类型 / DDL / API / 性能预算 | **agent 每个任务都要读对应那份** |
| `openspec/specs/` | 12 个模块行为规格 | agent |
| `openspec/gotchas.md` | 踩坑清单，第 11 章是性能类 19 条 | **agent 必读** |
| `openspec/project.md` | 项目总览、架构、provider 矩阵 | 你 + agent |
| `PERF-FIX-PLAN.md` | 参考实现的性能修复方案（原始推导过程，存档用） | 你（可选） |

## 五步开工

```bash
# 1. 建空仓库，拷脚手架与规格
mkdir agent-observability && cd agent-observability && git init
cp -r <本目录>/scaffold/* .
cp -r <本目录>/scaffold/.gitignore .
cp -r <本目录>/openspec .
cp <本目录>/AGENTS.md <本目录>/BOOTSTRAP.md <本目录>/PROMPTS.md .

# 2. 装依赖（Windows 需先确认 MSVC 工具链能编 better-sqlite3）
npm install

# 3. 建目录骨架
mkdir -p server/http server/storage server/realtime server/watch server/proxy server/desensitization
mkdir -p local-sessions src/adapters src/core src/components src/i18n src/generated
mkdir -p scripts perf-diag

# 4. 用 PROMPTS.md §2 的「项目启动提示词」让 agent 先复述理解，确认无偏差

# 5. 按 BOOTSTRAP.md 从 M0 开始，每个里程碑走 PROMPTS.md §11 的五步循环
```

## 每个里程碑的循环

```
BOOTSTRAP.md 查该 M 的「读 / 产出 / 验收」
  → Codex 跑 PROMPTS.md §3.1 写测试（此时全红）
  → DeepSeek 跑 §3.2 写实现（跑到全绿）
  → Codex 跑 §6 review（挑刺，先只报告不修）
  → M3 起加跑 §7 性能检查
  → typecheck + test + lint 全绿才提交
```

每 3 个里程碑跑一次 `PROMPTS.md` §9 反漂移检查。

## 三个最容易翻车的地方

1. **M5 adapters** —— OpenCode / CodeArts / CodeAgent2 的 `cacheRead` 是**累积值用 max**，其余 provider 是增量用 sum。参考实现在这里错了很久。一次只做一个 provider，用 §4 的专用提示词。
2. **M10c AgentOverview** —— 必须只发 1 个请求。参考实现在这里发了 524 个、传了 299.6MB。代码里出现 `sessions.map(s => fetch(...))` 就是错的。
3. **M4 增量门禁** —— `scan_state` 写入失败必须抛错。参考实现静默失败导致该表为 0 行，每轮重扫 800MB，而且完全无声。

## 关于本项目与"参考实现"

文档里说的「参考实现」指被复刻的那个已有项目。所有标了实测数字的地方（首屏 5,884ms、524 请求 / 299.6MB、18,235 条 SQL 等），描述的是**不做这些约束会长成的样子**，不是本项目的起点。

本项目是 0-1 全新构建，schema 从 v1 起，不迁移任何历史数据，性能预算从第一行代码就生效。
