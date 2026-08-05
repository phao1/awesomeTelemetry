# 给 Codex 的提示词 — add-mission-control

**想一次跑完 → 用 §0。** 下面的 A/B 是分批与长跑变体，一般用不到。

---

## 0. 一次跑完版（推荐，GUI 贴这一段）

```text
仓库里有一个写好的 OpenSpec change：openspec/changes/add-mission-control/
把外部参考实现 Tengu Lab 的指挥中心指标体系融入本项目。
本轮目标：一次跑完整个 change，中途不要停下来问我。

## 先读（按顺序，不许跳）
1. openspec/changes/add-mission-control/tasks.md —— **先读开头「已落地的前置工作」表**，
   P0 基建已经做了一大半，不要重做；那张表也写明了下一步的第一个缺口
2. openspec/changes/add-mission-control/design.md —— 全部裁决与理由，
   重点 §0（两个系统的数据底座差异）、§1（四项前置基建）、§7（契约）、§10（风险）
3. AGENTS.md —— 文档优先级 + 十条禁令 + 五条必做
4. openspec/contracts/{data-model,database,api,nfr}.md
5. openspec/gotchas.md 第 4 章（token 计算）+ 第 11 章（性能）

字段名/表名/路由/颜色值一律去契约里查，禁止凭记忆写。
文档冲突时按 AGENTS.md 优先级取高的，并在最终报告里列出冲突。

## 自主模式（本轮的关键约定）
这是一次无人值守长跑，我不在旁边。遇到需要人拍板的问题：
→ 记进 DECISIONS-PENDING.md（D-### 五段式：id/问题/试过什么/为什么不行/建议下一步）
→ 用一个合理的临时方案继续
→ 代码里打 // TODO(D-<id>):
→ **不要停下来等我**
唯一允许中止的情况：同一个问题修 3 次仍失败**且挡住后续工作**。

三个最容易卡住的点我已经替你决策了，直接照做、不要再问也不要推翻
（理由见 tasks.md 开头「已做的决策」）：
1. 定价表只收录有权威出处的 Anthropic 模型，其他厂商留空走 unknown 显示 —
2. compact 检测只做「上下文骤降 >50%」启发式，不读 Claude JSONL 字段；
   manual/auto 维度删除
3. schema 迁移失败就抛错提示用户删库重扫（已实现）

## 执行顺序
按 tasks.md 的「建议执行批次」表 B1→B8 依次做完，跳过已完成项：
B1 §0 契约 → B2 §4+§8.1 端点骨架+图表原子 → B3 §5+§8.2/8.3/8.5/8.6 P1 八个 widget
→ B4 §1+§2 时长与模型（补 writers/query-engine 读写新列，这是当前最大缺口）
→ B5 §3 定价接线 → B6 §6 P2 → B7 §7 P3 → B8 §8.4/8.7+§9 收口验收

每批结束：npm run typecheck && npm run test && npm run lint 全绿再提交。
一个任务组一次提交，提交信息格式见 AGENTS.md。做完把 tasks.md 对应 [ ] 勾成 [x]。
**不要攒一大批再提交** —— 出问题时没法精确回滚。

## 七条本次专属红线（违反即返工）
1. 禁止前端逐会话拉取。Mission 视图必须 1 个请求（G11.9 + frontend REQ-003）。
   负面基线：v4 的 Agent Overview 是 524 请求 / 299.6MB / 4732ms
2. 禁止同步大查询堵事件循环。better-sqlite3 是同步 API，一条 300ms 的 GROUP BY
   会顶穿 nfr.md §2 的「事件循环 p99 < 50ms」。单 widget SQL 实测 < 30ms，
   A/B/C 三区之间必须 await setTimeout(0) 让出。超标就按 nfr §7 升级为日粒度
   rollup 表，不要靠加索引硬撑
3. 禁止用 0 冒充 null。算不出来的 widget 返回
   { available:false, data:null, unavailableReason:'...' }，前端渲染 EmptyState。
   MissionWidget<T> 类型已在 src/core/trace-types.ts 里定义好，直接用
4. 禁止凭记忆写模型价格。src/core/pricing.ts 的内置表已经填好且每条带 source，
   不要改动它；要扩别的厂商就走 config/model-pricing.json 覆盖层
5. 禁止把推导时长当测量时长卖。sessions.duration_source 已经在 adapter 侧产出，
   所有耗时面板的 criteria 行必须读它，为 derived 时标注「含调度间隙」
6. 禁止正文出服务端。B7 场景分类、B10 命令审计只返回聚合结果 + 脱敏限长预览
   （200 字符），响应体里不得出现未脱敏的 prompt / 命令原文
7. 禁止新增运行时依赖。7 个图表原子全部手写 SVG

## 两条有意偏离参考实现的决定（不要"修正"回去）
- Tengu 有 60s 自动刷新，本项目不做轮询，改 SSE stamp 失效 + 手动刷新
  （frontend REQ-023 禁止轮询 / nfr「30s 窗口 < 15 请求」）
- 阶段耗时四段沿用本项目的 model/tool/idle/userWait，不改成 Tengu 的
  LLM/Tool/Blocked/Other —— userWait 语义比 Blocked 更准

## 收口
全部做完后：
- openspec validate add-mission-control --strict 通过
- 真机跑一次 npm run build && npm start，贴出 GET /api/mission 的真实响应片段
  （meta 行 + 至少 3 个 widget 的 criteria），不要用「测试全绿」冒充「产品能用」
- PROGRESS.md 追加一行；perf:check 结果追加到 PERF-BASELINE.md
- 按 AUTOPILOT.md §8 输出终止报告：已完成 / 提交列表 / D-### 待办 /
  **我不确定的地方（诚实完整，写 none 需要有把握）** / 建议下一步
```

---

## A / B：分批与长跑变体

下面两个版本按你的使用方式选一个：

- **A. GUI 交互版**（推荐）——在 Codex 图形界面里逐批跑，你在场、可以答问
- **B. CLI 无人值守版** —— `codex exec` 长跑，套用 `CODEX-RUN.md` 的 AUTOPILOT 规则

⚠️ 两者最大的区别：**A 版允许 Codex 停下来问你，B 版不允许**。
`CODEX-RUN.md` §0 那条「不许停下来问、记 D-### 继续跑」是为无人值守设计的，
**GUI 交互时不要套用** —— 你人就在旁边，让它把定价表来源、compact 字段是否存在
这类问题直接问出来，比它自己猜一个再记进 `DECISIONS-PENDING.md` 划算得多。

---

## A. GUI 交互版

### A-1 首轮（开新会话时贴这一段）

```text
仓库里有一个已经写好的 OpenSpec change：openspec/changes/add-mission-control/
任务是把外部参考实现 Tengu Lab 的指挥中心指标体系融入本项目。

## 先读这些（按顺序，不许跳）

1. AGENTS.md —— 文档优先级 + 十条禁令 + 五条必做
2. openspec/changes/add-mission-control/design.md —— 全部裁决与理由，重点是
   §0（两个系统的数据底座差异）、§1（四项前置基建）、§10（风险清单）
3. openspec/changes/add-mission-control/tasks.md —— 你的执行清单，
   开头「建议执行批次」表说明了做的顺序
4. openspec/contracts/{data-model,database,api,nfr}.md —— 权威契约
5. openspec/gotchas.md 第 4 章（token 计算）+ 第 11 章（性能）

冲突时按 AGENTS.md 的文档优先级裁定，并在回复里显式指出冲突。
**字段名 / 表名 / 路由 / 颜色值一律去契约里查，禁止凭记忆写。**

## 本轮只做批次 B1（tasks.md §0：8 处契约改动）

不要顺手往下做。契约是代码生成的权威输入，先落契约，我确认后再动代码。

## 这个 change 的本质（决定了你会遇到的所有"为什么不做"）

移植 Tengu Lab 的指标口径和信息架构，不移植它的数据源。

Tengu 的数据底座是 Claude Code 官方遥测事件 + OTel span；本项目是 9 家厂商
的本地会话文件 + 可选 MITM 抓包。design.md §0 那张对照表解释了所有"不可融入"
的成因。凡是只能由官方遥测提供的指标（权限模式 / SDK 结果 / 阻塞时长 /
prompt effort·source），design.md §3-§5 已逐条拒绝并写了理由。
**不要试图用近似值把它们补上** —— 一个说不清口径的数字比没有这个数字更糟。

## 七条本次专属红线（违反即返工）

1. 禁止前端逐会话拉取。Mission 视图必须是 1 个请求（G11.9 + frontend REQ-003）。
   负面基线：v4 的 Agent Overview 是 524 请求 / 299.6MB / 4732ms。
2. 禁止同步大查询堵事件循环。better-sqlite3 是同步 API，一条 300ms 的 GROUP BY
   会顶穿 nfr.md §2 的「事件循环 p99 < 50ms」。单 widget SQL 实测 < 30ms，
   A/B/C 三区之间必须 await setTimeout(0) 让出。
3. 禁止用 0 冒充 null。算不出来的 widget 返回
   { available:false, data:null, unavailableReason:'...' }，前端渲染 EmptyState。
4. 禁止凭记忆写模型价格。每条价格必填 source（URL + 抓取日期）。查不到的模型
   不写，让它走 cost_source='unknown' 显示 —。
5. 禁止把推导时长当测量时长卖。claude/codex/opencode-db 的 durationMs 当前恒为 0，
   本次改为相邻时间戳推导，必须由 sessions.duration_source 标注。
6. 禁止正文出服务端。B7 场景分类、B10 命令审计只返回聚合结果 + 脱敏限长预览。
7. 禁止新增运行时依赖。7 个图表原子全部手写 SVG。

## 两条有意偏离参考实现的决定（不要"修正"回去）

- Tengu 有 60s 自动刷新，本项目不做轮询，改 SSE stamp 失效 + 手动刷新
  （frontend REQ-023 禁止轮询 / nfr「30s 窗口 < 15 请求」）。
- 阶段耗时四段沿用本项目的 model/tool/idle/userWait，不改成 Tengu 的
  LLM/Tool/Blocked/Other —— userWait 语义比 Blocked 更准。

## 工作方式

- 一个任务组一次提交，提交信息格式见 AGENTS.md
- 测试与源码同目录（foo.ts + foo.test.ts），先写测试再写实现
- 每批结束跑 npm run typecheck && npm run test && npm run lint
- 做完把 tasks.md 里对应的 [ ] 勾成 [x]
- **有疑问直接问我**，不要猜、也不要自己记进 DECISIONS-PENDING.md 就往下跑。
  尤其这几处务必问：模型定价表的数据来源、Claude JSONL 是否真的带 compact 标记、
  schema v2 迁移失败时的回退策略。

## 完成时输出

## Delivered
- path/to/file.ts — 一句话
## Contract mapping
- implements <module> REQ-00X
- not implemented: REQ-00Y（原因）
## Needs confirmation
-（没有就写 none）
```

### A-2 续跑（后面每一批贴这一句就行）

```text
继续 openspec/changes/add-mission-control/，本轮做批次 B2
（tasks.md §4 聚合端点骨架 + §8.1 七个 SVG 图表原子）。
先看 tasks.md 开头的「建议执行批次」表确认范围，七条红线和上轮一致。
做完勾选 tasks.md 对应条目并给出 Delivered / Contract mapping / Needs confirmation。
```

把 `B2` 和括号里的章节号换成下一批即可。**一次会话只做一批** —— 全清单约 90 个
勾选项，一口气跑会把上下文撑爆，也没法精确回滚。

### A-3 如果 Codex GUI 支持 skills

仓库 `.codex/skills/` 里有 6 个 OpenSpec skill，其中 `openspec-apply-change`
就是干这个的。支持的话首轮可以直接说：

```text
用 openspec-apply-change skill 实现 add-mission-control，本轮只做 tasks.md §0。
另外遵守 openspec/changes/add-mission-control/codex-prompt.md 里的七条红线。
```

不支持就用 A-1，效果一样，只是要它自己读文件。

---

## B. CLI 无人值守版

套用仓库已有的 `CODEX-RUN.md` 流程，把它 §2「What to execute」的四个 change
换成 `add-mission-control`，然后：

```bash
codex exec -s workspace-write -a never "$(cat CODEX-RUN.md)"
```

这条路径下 `AUTOPILOT.md` §4 生效：遇到需要人拍板的问题 → 记
`DECISIONS-PENDING.md` D-### → 用临时方案继续 → 代码里打 `// TODO(D-<id>):`
→ 不停下等待。

⚠️ 但这个 change 有 **3 处不适合无人值守自己拍板**，建议先用 GUI 把它们定了
再开长跑：

1. **模型定价表的数据来源**（design.md R3）—— 猜错价格会让整个 B 区的成本数字
   全错，而且错得很难被发现
2. **Claude JSONL 是否带 compact 标记**（B12）—— 需要实地读 `~/.claude/projects`
   验证，猜不出来
3. **schema v1→v2 迁移失败的回退策略**（R7）—— 涉及用户数据，不该由无人值守决定
