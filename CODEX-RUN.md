# CODEX-RUN.md — 长跑启动提示词

> 用法：`codex exec -s workspace-write -a never "$(cat CODEX-RUN.md)"`
> 或交互式：`codex -s workspace-write -a never` 然后粘贴下面 `---` 之间的全文。

---

你现在开始一次**无人值守长跑**，基于 OpenSpec 做 SDD 开发。目标是把 Agent Observability
从「能启动但点了没反应、界面很糙」做到「开发者最愿意打开的 Agent 可观测工具」。

## 0. 冲突裁决（先读这条，否则你会在第一个歧义处停住）

有**两处**规则会让你停下来等人。本次是**无人值守长跑**，没有人在旁边回答你，
所以两处都要按下面的裁决处理：

**① `AGENTS.md` 的「遇到歧义怎么办 → 停下来问，不要猜」**

> 本次运行中，`AUTOPILOT.md` §四 **覆盖** `AGENTS.md` 的「停下来问」。

**② `openspec-apply-change` skill 的 Guardrails**

该 skill 写着「Pause if: task is unclear / on errors, blockers, or unclear
requirements - don't guess」「pause and ask before implementing」。
那是为**交互式**设计的。本次运行中：

> **不要 pause and ask。** skill 的工作流（`openspec status` → `openspec instructions
> apply` → 读 contextFiles → 逐任务实现 → 勾选 → 继续）**全部照用**，
> 唯独把「pause and ask」替换为下面的处置。

**两处统一的处置方式**：遇到需要人决策的问题 →
记入 `DECISIONS-PENDING.md`（D-### 五项格式：编号 / 问题描述 / 尝试过的方案 /
失败原因 / 建议的下一步）→ 用临时方案继续 → 代码里加 `// TODO(D-<编号>):` 标记
→ **不要停下等待**。

唯一允许真正停下的情况：`AUTOPILOT.md` §三 的「同一问题修 3 次仍失败**且阻塞后续**」。

`AGENTS.md` 的其余全部内容（权威文档优先级、十条禁令、五条必做）**继续完全有效**。

## 0.5 用 OpenSpec skill 驱动

本仓库已装好 6 个 OpenSpec skill（`.codex/skills/`）。**优先用它们**，
它们比手写流程可靠——`openspec instructions apply --change <id> --json` 会直接返回
contextFiles、进度、以及随状态变化的动态指令。

| skill | 用途 |
|-------|------|
| `openspec-apply-change` | **本次主力**：实现某个 change 的任务 |
| `openspec-archive-change` | 一个 change 全部完成后归档 |
| `openspec-explore` | 查看现有 specs / changes |
| `openspec-propose` | 下一轮新需求时用（本次用不到，四个 change 已就绪） |

**注意**：`openspec update` / `openspec init` **不要加 `--force`** ——
它会把 `openspec/project.md` 当 legacy 清理掉，而那是 `AGENTS.md` 权威列表第 7 项。

## 1. 先读这些（按顺序，别跳）

1. `AGENTS.md` —— 权威文档优先级、十条禁令、五条必做
2. `AUTOPILOT.md` —— 三条绝对禁令、卡住怎么办、终止报告格式
3. `UI-TASKS.md` §1–§2 —— 本轮要修的 6 个缺陷的**实机证据与精确定位**
4. `openspec/contracts/design-tokens.md` —— 视觉数值契约（新增，权威）
5. `openspec/specs/design-system/spec.md` —— 图标/组件/四态/快捷键（新增）
6. `openspec/specs/frontend/spec.md` —— 已重写，REQ-015 起为新增页面设计
7. `openspec/specs/session-scanning/spec.md` REQ-021 / REQ-022 —— 后端两条新需求

**任何时候都不要凭记忆写字段名、表名、路由、颜色值。去契约里查。**

## 2. 执行什么

四个 OpenSpec change，**严格按顺序**，前一个 archive 后才开始下一个：

```
1. fix-session-data-integrity    24 tasks   后端：真实标题 / SQLite 详情 / proxy·frida 路由
2. add-design-system             31 tasks   token 层 / 47 图标 / 25 基础组件
3. redesign-frontend-views       50 tasks   共享 store / 四态 / AppShell / 五视图重做
4. add-palette-and-a11y          30 tasks   ⌘K / 快捷键 / URL 状态 / a11y / 契约断言收口
```

顺序不可颠倒：数据是空的时候做 UI 等于给空壳刷漆；没有 token 层就加不上暗色模式。

## 3. 工作循环（每个 change 内部）

优先走 `openspec-apply-change` skill（§0.5）；它的内部步骤等价于下面这个循环：

```
openspec status --change <id> --json           # 看还剩哪些 artifact / 任务
openspec instructions apply --change <id> --json  # 拿 contextFiles + 动态指令
读 proposal.md → design.md → tasks.md   # design.md 里有关键决策的理由，别绕过
挑下一个未勾选任务组
  → 先写测试（与源码同目录 foo.test.ts，测试即契约的可执行形式）
  → 再写实现，逐条对照 spec REQ
  → npm run typecheck && npm run test && npm run lint  全绿
  → 在 tasks.md 里把对应 [ ] 改成 [x]
  → git commit（信息格式见 AGENTS.md）
重复直到该 change 全部任务勾完
  → openspec validate <id> --strict
  → 输出该阶段的实机验证报告（见 §5）
  → openspec archive <id>
  → 进入下一个 change
```

**一个任务组一个 commit。** 不要攒一大堆再提交——出问题时无法精确回退。

## 4. 硬规则（违反则本次产出作废）

来自 `AUTOPILOT.md` §一 与 `AGENTS.md`：

1. **不修改已通过的测试。** 测试变绿后就是契约。放宽断言、删用例、加 `.skip` 都算违反。
   唯一例外：能引 `openspec/` 契约原文证明该断言与契约矛盾，
   且必须先在 `DECISIONS-PENDING.md` 记一条 D-### 再改。
2. **不 mock `fs` / `child_process` / `better-sqlite3`。** 只有靠 mock 才能过的测试，
   说明现在验证不了，记入待决清单并跳过。
3. **不引入新依赖**（`@types/*` 除外）。图标、tooltip、虚拟滚动、拖拽、路由、快捷键
   **全部手写**。这是硬约束，不是建议。
4. `AGENTS.md` 的十条禁令逐条有效，尤其：
   - 禁止前端 `sessions.map(s => fetch(...))`（G11.9）
   - 禁止 `spawnSync` / 大文件 `readFileSync` 出现在 HTTP 请求路径上
   - 禁止 `SELECT *`
5. **新增的第 11 条**：禁止空 `catch {}` 或只含注释的 catch。
   本轮已确认 7 处，它们正是「点了没反应」的根源。

## 5. 每个 change 结束时输出实机验证报告

不要用「测试全绿」冒充「产品可用」——上一轮 246 个测试全绿但浏览器打开是 404。
每个 change archive 前，**真的启动一次**（`npm run build && npm start`）并贴出真实输出：

- **change 1**：`GET /api/sessions?limit=10` 的真实 title 列表（证明不再是文件名）、
  opencode/codearts 会话的 events 数量、`POST /api/proxy/start` 的真实响应
- **change 2**：`npm run test` 中 T1–T7 七条断言的结果、CSS gzip 体积、图标集体积
- **change 3**：五个视图逐一走查结论、kill 后端后点击会话的表现、9,590 event 会话的 DOM 节点数
- **change 4**：键盘全流程走查结论、200% 缩放结论、首屏性能实测数字

## 6. 卡住时

同一问题第 3 次修复仍失败：

- 回退到最后可编译状态
- 按 D-### 五项格式记入 `DECISIONS-PENDING.md`（编号 / 问题描述 / 尝试过的方案 / 失败原因 / 建议的下一步）
- 不阻塞后续 → 跳过继续
- 阻塞后续 → 停止长跑，提交已完成部分，输出终止报告

## 7. 结束时

停在最近一个**完整提交**上，不留半成品到主线，按 `AUTOPILOT.md` §八 输出终止报告：

```
## 长跑终止报告（<日期时间>）

### 完成情况
- 逐 change：完成 / 部分完成（列出具体产出与验收结果）

### 提交清单
- <commit hash> <一句话>

### 待决清单
- D-###：一句话 + 状态

### 我不确定的地方
- 诚实写满；写"无"需要有底气

### 下一步建议
- 从哪个 change 哪个任务组继续
```

## 8. 质量优先于进度

宁可少做，不可做假。**做完 1 个扎实的 change，远好于 4 个测试被改绿的 change。**

现在开始：先 `openspec list` 确认四个 change 都在，然后
`openspec status --change fix-session-data-integrity`，开始第 1 个任务组。
