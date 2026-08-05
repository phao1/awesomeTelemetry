# 给 Codex 的提示词 — calibrate-tokens-and-compare-report

**想一次跑完 → 用 §0。** §A 是分批交互版，§B 是无人值守长跑版。

---

## 0. 一次跑完版（推荐，GUI 贴这一段）

```text
仓库里有一个写好的 OpenSpec change：openspec/changes/calibrate-tokens-and-compare-report/
本轮目标：一次跑完整个 change，中途不要停下来问我。

## 先读（按顺序，不许跳）
1. openspec/changes/calibrate-tokens-and-compare-report/design.md
   —— 重点 §1（逐项判定表：哪些已经做过了，别重做）和 §2（唯一允许的 token 归因方式）
2. 同目录 tasks.md —— 先读开头「三条最容易做错的事」，再看「建议执行批次」表
3. AGENTS.md —— 文档优先级 + 十条禁令 + 五条必做
4. openspec/contracts/{data-model,database,design-tokens}.md
5. openspec/gotchas.md 第 4 章（token 计算）
同目录还有 reference-external-spec.md，那是外部参考原文，**不是待办清单**，
它的文件路径大半在本仓库不存在。有冲突一律以 design.md 为准。

字段名/表名/路由/颜色值一律去契约里查，禁止凭记忆写。
文档冲突时按 AGENTS.md 优先级取高的，并在最终报告里列出冲突。

## 这个 change 的本质（决定了你会遇到的所有「为什么不做」）
外部那份变更说明是**另一个代码库**的 diff。它的三条 token 校准结论本仓库
2026-08-03 已经独立对账落地（gotchas G4.2/G4.4/G4.5），它的"修改前"代码在本仓库
一行都找不到。所以这不是"应用一份 patch"，是"把仍然成立的部分按本仓库架构重做"。

开工第一件事，跑这三条自查，确认你面对的是本仓库而不是那份说明里的仓库：
  grep -rn "TOKEN_DIVISOR" --include="*.ts" .     # 必须零命中
  ls src/i18n.ts src/styles/tokens.css            # 存在（不是 src/i18n/index.ts、src/App.css）
  ls src/components/Compare*.tsx                   # 只有 CompareBoard.tsx
对不上就停下来告诉我，别硬做。

## 自主模式（本轮的关键约定）
这是一次无人值守长跑。遇到需要人拍板的问题：
→ 记进 DECISIONS-PENDING.md（D-### 五段式：id/问题/试过什么/为什么不行/建议下一步）
→ 用一个合理的临时方案继续
→ 代码里打 // TODO(D-<id>):
→ **不要停下来等我**
唯一允许中止的情况：同一个问题修 3 次仍失败**且挡住后续工作**。

已经替你决策了的四件事，直接照做、不要再问也不要推翻（理由见 design.md）：
1. 品牌名 = AwesomeTelemetry，全量改名（含 package/bin/数据目录/localStorage），
   但数据目录与 localStorage **必须带兼容回退**（design.md §8，这是验收项）
2. 主题色改 teal，取值直接抄 design.md §9 的表格（已按 WCAG 公式实测过对比度），
   不要自己挑颜色，也不要动 --phase-implement 和 --seg-model
3. 代码精炼度口径 = totalSteps / fileWriteCount，写进 spec 和 UI criteria 行
4. TraceDimensionMetrics 类型不动 —— 三维是展示层的事，不是指标模型的事

## 执行顺序
按 tasks.md 的「建议执行批次」表 B1→B9 依次做完：
B1 Token 归因（起点，必须先做）→ B2 SpeedMetrics/TokenUsage 新字段
→ B3 TraceMetrics 新字段 + schema v4 → B4 Trae adapter 增强
→ B5 对比报告 4→3 维 + i18n → B6 品牌改名 + teal + favicon
→ B7 服务端端口探测 + systemPrompt 调查 → B8 Trae 子代理关联（先调查后设计）
→ B9 收口验收

B4/B6/B7 与 B1-B3 无依赖，可以穿插做。B8 必须最后做且必须先调查。
每批结束：npm run typecheck && npm run test && npm run lint 全绿再提交。
一个批次一次提交，提交信息格式见 AGENTS.md。做完把 tasks.md 对应 [ ] 勾成 [x]。
**不要攒一大批再提交** —— 出问题时没法精确回滚。

## 八条本次专属红线（违反即返工）

1. **禁止把归因的 token 写回 event.tokens。** 这是本次最重要的一条。
   外部说明 §2.2-C 给的代码片段（classified[i].inputTokens = classified[j].inputTokens）
   会精确复现它自己在 §4.1 里承认的 bug —— 会话级 aggregateTokenUsage 对所有
   tokens 非空的事件无差别求和，写回去就是双计。
   正确做法：新增只读纯函数返回 Map<eventId, TokenUsage>，见 design.md §2。
   护栏测试：computeTokenBreakdown(record).total 在调用归因函数前后必须完全相等。

2. **归因必须 1:1，不是 1:N。** 一个 carrier 的 token 只能给一个 llm 事件，
   消费后标记已用。TPS 是「每事件 output/duration 的算术平均」，同一份 output
   被 3 个事件各算一次，TPS 直接虚高 3 倍。

3. **禁止重做已经落地的东西。** TOKEN_DIVISOR 不存在、cache.read 已经是求和
   （helpers.ts:109）、reasoningInTotal 方言已经有（opencode.ts:29）、
   orderEventsByTime 已经是稳定排序（helpers.ts:141）。
   动它们 = 把对的改成错的。判定表见 design.md §1。

4. **禁止用 0 冒充 null。** 分母为 0 的指标返回 null，UI 渲染 —。
   一个说不清口径的 0 比没有这个数字更糟。

5. **加了 metrics 字段就必须 bump METRICS_CALC_VERSION（3→4）。**
   不 bump 的话老行 calc_version 已经是 3，永远不会触发重算，
   新列全是默认值而且没有任何报错。同理 SCHEMA_VERSION 3→4，
   并且 writers.ts 和 query-engine.ts 都要接上新列
   —— add-mission-control 的教训是「schema 加了列但存储层没接，widget 全读空值」。

6. **禁止发明不存在的数据源。** Trae systemPrompt 在本仓库没有任何捕获机制。
   先调查（解密库里有没有？MITM 能不能拿到？），没有就停手记 D-###，
   不要凭空约定一个「从某个路径加载」的文件 —— 那是永远不会有人写入的死代码。

7. **改名不许弄丢用户数据。** 数据目录和 localStorage 键的兼容回退是验收项：
   新目录不存在且老目录存在 → 继续用老目录 + 打提示，不自动搬运、不静默建空库。

8. **B8 先调查后设计。** Trae 子代理这一项禁止直接写代码。先回答 design.md §10
   的三个问题（distinct session_id 数量 / 有无父子字段 / 子代理 agent_type 长什么样），
   再按闸门表选方案。而且不许打破 T-03（索引与详情 key 都是
   deriveSessionKey(config.key, filePath)），不许新写一套合并逻辑
   （已有 buildSubagentMergeGroups）。

## 拿不到真机数据时怎么办
config 里 traeKeyPath 是 null，Trae 路径是 %APPDATA%（Windows），
当前机器很可能读不到真实 Trae/CodeArts 库。
→ 降级为 fixture 驱动 + 记 D-###，**禁止编造校准数字**，
   最终报告必须诚实写明哪些结论未经真机验证。
→ 尤其 B4 的工具名清单（那是外部说明给的，本仓库没验证过）和 B8 的子代理方案。

## 收口
全部做完后：
- openspec validate calibrate-tokens-and-compare-report --strict 通过
- npm run typecheck && npm run test && npm run lint 全绿
- npm run perf:check，结果追加到 PERF-BASELINE.md
- 真机跑一次 npm run build && npm start，贴出真实会话 GET /api/sessions/:key 的
  响应片段（含新增指标字段的真实值），不要用「测试全绿」冒充「产品能用」
- 贴出对比页三维卡片的实际渲染结果
- PROGRESS.md 追加一行；新增 D-### 汇总进 DECISIONS-PENDING.md
- 按 AUTOPILOT.md §8 输出终止报告：已完成 / 提交列表 / D-### 待办 /
  **我不确定的地方（诚实完整，写 none 需要有把握）** / 建议下一步
```

---

## A. GUI 交互版（你在场、可以答问时用）

### A-1 首轮

把 §0 整段贴进去，然后把「自主模式」那一节替换成：

```text
## 工作方式
- 本轮只做 B1（Token 归因 + 反双计回归测试）。不要顺手往下做。
- 一个任务组一次提交，测试与源码同目录，先写测试再写实现
- **有疑问直接问我**，不要猜、也不要自己记进 DECISIONS-PENDING.md 就往下跑
- 尤其这几处务必问：
  1. OpenCode fixture 里 step part 和 llm part 的实际前后顺序（这决定归因方向，
     外部说明给的 i+1..i+5 是它那个数据结构的经验值，本仓库要实测）
  2. 能不能访问真实 Trae / CodeArts 数据库（决定 B4/B8 是真做还是降级）
  3. Trae 解密库里到底有没有 system prompt（决定 B7 做不做）

## 完成时输出
## Delivered
- path/to/file.ts — 一句话
## Contract mapping
- implements metrics-analysis REQ-00X
- not implemented: REQ-00Y（原因）
## Needs confirmation
-（没有就写 none）
```

### A-2 续跑（后面每批贴这一句）

```text
继续 openspec/changes/calibrate-tokens-and-compare-report/，本轮做 B2
（tasks.md §2：SpeedMetrics / TokenUsage 新字段）。
先看 tasks.md 开头「三条最容易做错的事」和「建议执行批次」表确认范围，
八条红线与上轮一致。做完勾选 tasks.md 对应条目并给出
Delivered / Contract mapping / Needs confirmation。
```

把 `B2` 和括号里的章节号换成下一批即可。**一次会话只做一批。**

---

## B. CLI 无人值守版

```bash
codex exec -s workspace-write -a never "$(cat openspec/changes/calibrate-tokens-and-compare-report/codex-prompt.md)"
```

这条路径下 `AUTOPILOT.md` §4 生效（记 D-### 继续跑，不停下等待）。

⚠️ 但有 **3 处不适合无人值守自己拍板**，建议先用 GUI 定了再开长跑：

1. **归因方向的实测结论**（B1）—— 猜错会让 TPS/TPOT 全错，而且错得像"能算出来了"
   一样有欺骗性
2. **真实 Trae / CodeArts 数据库能不能访问**（B4/B8）—— 决定这两批是真做还是降级，
   影响近三分之一工作量
3. **Trae systemPrompt 有没有数据源**（B7）—— 无人值守很容易"发明"一个路径把
   死代码写上去
