# PROMPTS.md — codex + DeepSeek 开发提示词

> 直接复制粘贴。`<尖括号>` 是需要你替换的占位符。

## 0. 模型分工建议

| 任务类型 | 用哪个 | 为什么 |
|---------|-------|-------|
| 里程碑规划、跨文件重构、review | **Codex**（强模型） | 需要全局一致性判断 |
| 单文件实现（给定紧规格） | **DeepSeek v4 Flash** | 规格够紧时它足够，且快、便宜 |
| 写测试用例 | **Codex** | 测试是契约的可执行形式，写松了就没用 |
| 修 bug、查 typecheck 报错 | DeepSeek 先试，卡住换 Codex | |
| 涉及 gotchas 的模块（adapters / trae / watch） | **Codex** | 这些地方"看起来对但实际错"的陷阱最多 |

**关键原则：让 Codex 写测试，让 DeepSeek 写实现。** 测试写对了，DeepSeek 的实现就有了收敛目标；反过来则会双双跑偏。

## 1. 上下文加载策略

3200 行规格无法每次全塞。分三层：

| 层 | 内容 | 何时加载 |
|----|------|---------|
| **常驻** | `AGENTS.md`（约 150 行） | 每次。Codex 会自动读仓库根的 AGENTS.md |
| **契约** | 当前任务需要的 1–2 份 `contracts/*.md` | 每个任务开始时 |
| **模块** | 当前模块的 `specs/<m>/spec.md` + gotchas 相关章节 | 每个任务开始时 |

单次任务的上下文控制在 **AGENTS.md + 1 份契约 + 1 份模块 spec ≈ 600–900 行**，这是 DeepSeek 也能稳定处理的量。

**不要**把全部 12 份 spec 一次性喂进去——注意力被稀释后，它会开始"综合各处印象"编字段名。

---

## 2. 项目启动提示词（只用一次）

```
这是一个 0-1 的 TypeScript 项目。仓库里已有完整规格，位于 openspec/ 目录。

先做三件事，不要写任何业务代码：

1. 完整读取并复述以下文件的要点（每份 5 行以内）：
   - AGENTS.md
   - BOOTSTRAP.md
   - openspec/README.md
   - openspec/project.md

2. 列出 M0 脚手架需要产出的全部文件清单，逐个说明用途。

3. 指出你在这些文档中发现的任何矛盾、歧义、或信息缺失。
   如果没有，明确说"无"。不要为了显得认真而编造问题。

做完这三件事就停下，等我确认后再开始 M0。
```

> 第 3 步是关键。让它先暴露理解偏差，比等它写完 12 个文件再发现便宜得多。

---

## 3. 里程碑实现提示词（主力模板）

每个里程碑用一次。**先让 Codex 跑一遍"测试先行"，再让 DeepSeek 补实现。**

### 3.1 阶段 A — 让 Codex 写测试

```
任务：<M4 watch 增量门禁> 的测试先行。

必读（完整读取，不要跳读）：
- AGENTS.md
- openspec/specs/session-scanning/spec.md 的 REQ-001 / REQ-002 / REQ-003 / REQ-008
- openspec/contracts/data-model.md 的 §8 扫描状态
- openspec/gotchas.md 的 G11.5 / G11.15 / G11.18

这一步**只写测试，不写实现**。产出：
- server/watch/fingerprint.test.ts
- server/watch/scan-gate.test.ts
- server/watch/jsonl-reader.test.ts

要求：
1. 每个 REQ 至少一个用例，用例名里带上 REQ 编号，例如
   it('REQ-001 无变更重扫时零 SQL 写入', ...)
2. BOOTSTRAP.md 里 M4 的「验收」每一条都要有对应用例
3. 测试必须能真实失败——不要写 expect(true).toBe(true) 这类占位
4. 需要 fixture 就在 __fixtures__/ 下创建真实的小文件，不要 mock fs
5. 现在跑测试应该全部失败（因为实现还不存在），这是预期的

写完后列出：每个测试文件有几个用例、分别对应哪个 REQ。
```

### 3.2 阶段 B — 让 DeepSeek 写实现

```
任务：实现 <M4 watch 增量门禁>，让已有测试全部通过。

必读：
- AGENTS.md（尤其"十条禁令"）
- openspec/specs/session-scanning/spec.md 的 REQ-001 / REQ-002 / REQ-003 / REQ-008
- openspec/contracts/data-model.md 的 §8
- 已存在的测试文件：server/watch/*.test.ts

产出（只创建这些文件，不碰其他任何文件）：
- server/watch/fingerprint.ts
- server/watch/scan-gate.ts
- server/watch/jsonl-reader.ts

硬性约束：
1. 类型逐字采用 contracts/data-model.md §8 的 ScanState 与 FileFingerprint
2. 不改动任何 .test.ts 文件。测试跑不过就修实现
3. 不引入新的 npm 依赖
4. scan_state 写入失败必须 throw，不许静默 catch
5. WAL 型数据源的指纹必须同时覆盖主文件与 -wal 文件

完成后按 AGENTS.md 的输出格式收尾，并贴出 npm test 的结果。
```

> 换里程碑时，替换掉方括号里的模块名、必读清单、产出文件清单三处即可。
> 每个里程碑的这三项，`BOOTSTRAP.md` 里都写好了。

---

## 4. Adapters 专用提示词（M5 最容易出错）

adapters 是全项目 gotchas 密度最高的地方，值得单独一套。**一次只做一个 provider。**

```
任务：实现 src/adapters/<opencode>.ts 一个文件。

必读：
- AGENTS.md
- openspec/specs/adapters/spec.md 全文
- openspec/contracts/data-model.md 的 §1 §2 §4 §5
- openspec/gotchas.md 的第 4 章（Token 计算）与第 9 章（Provider 特定）

这个 provider 的特殊规则（逐条确认你理解了再动手）：
- cacheRead 语义是 <cumulative>，会话级聚合用 <Math.max()>
- reasoning 语义是 incremental，用 sum
- total = input + output + reasoning + cacheRead，不含 cacheWrite
- <其他 provider 特定规则，从 specs/adapters REQ-00X 抄过来>

产出：
- src/adapters/opencode.ts
- src/adapters/opencode.test.ts
- src/adapters/__fixtures__/opencode-minimal.json

测试必须覆盖这 6 条：
1. 最小 fixture 的完整 TraceRecord 快照
2. cacheRead 用 max 而非 sum（构造 3 个 event，cacheRead 分别为 100/200/150，
   断言会话级为 200 而不是 450）
3. total 公式包含 reasoning
4. 状态归一化：completed→success / paused→running / canceled→cancelled / 未知→unknown
5. 同 session 重复 event id 加 :{sequence} 后缀
6. title 截断到 200 字符，raw 与 inputSummary/outputSummary 分离返回

写完自查：把第 2 条的断言念一遍，确认它测的是 max 不是 sum。
这一条在参考实现里错了很久，是本项目最容易踩的坑。
```

---

## 5. 前端提示词（M10，按子任务拆）

```
任务：实现 <M10c 详情与聚合>。

必读：
- AGENTS.md
- openspec/specs/frontend/spec.md 的 REQ-003 / REQ-004 / REQ-005 / REQ-008 / REQ-009
- openspec/contracts/api.md 的 §1 §2
- openspec/gotchas.md 的第 7 章 + G11.9

产出：
- src/components/EventInspector.tsx
- src/components/AgentOverview.tsx
- 对应测试

两条红线，违反直接返工：
1. AgentOverview 只能发起 1 个请求（GET /api/agent-overview）。
   代码里出现任何形如 sessions.map(s => fetch(...)) 的写法都是错的。
2. EventInspector 点击 event 时才拉正文（GET /api/sessions/:key/events/:id，
   200ms 防抖），不能随详情一起拉。

写完后回答一个问题：如果用户的库里有 5000 个会话，
你写的 AgentOverview 会发出几个请求？答案必须是 1。
```

---

## 6. Review 提示词（每个里程碑合入前，用 Codex）

```
对刚完成的 <M4> 做一次严格 review。你现在的角色是挑刺的人，不是完成任务的人。

逐条检查 AGENTS.md 的「十条禁令」，对每一条给出：
- 结论（通过 / 违反 / 不适用）
- 如果违反，给出 file:line 与修复建议

然后检查这四项：
1. 是否有测试断言被改松或被删掉？对比 git diff 确认
2. 是否有被 mock 掉的真实逻辑？特别注意 fs、child_process、better-sqlite3
3. 是否引入了 AGENTS.md 允许清单之外的依赖？检查 package.json diff
4. openspec/specs/<module>/spec.md 里的 REQ 有没有漏实现的？逐个编号对照

最后跑一遍 npm run typecheck && npm run test && npm run lint，贴出结果。

不要为了让 review 通过而修改代码——先只报告问题。
```

---

## 7. 性能验收提示词（M3 之后每个里程碑）

```
跑一次性能基线检查。

1. 执行 perf-diag/ 下的 Step 1（EXPLAIN QUERY PLAN）与 Step 2（服务端分段耗时）
2. 对照 openspec/contracts/nfr.md §2 的预算表，逐行填写实测值
3. 任何超预算的项，给出：实测值 / 预算值 / 超出倍数 / 定位到的原因
4. 把结果追加到 PERF-BASELINE.md

约束：
- 只测量，不优化。发现问题先报告，我决定要不要现在修
- 每个结论必须有数字。没有数字的判断标记为「未验证猜测」，单独列一节
- 不要说「可能」「建议」，只报告「实测 X 为 Yms，预算 Zms，超出 N 倍」
```

---

## 8. 卡住时的提示词

```
你在 <描述卡点> 上卡住了。停止尝试新方案。

按这个顺序回答：
1. 你到底在解决什么问题？用一句话说清，不要复述代码
2. 你已经试过哪些方案？每个失败的原因是什么？
3. 你当前对系统行为的假设是什么？这些假设里哪个最没被验证过？
4. 要验证那个假设，最小的实验是什么？

先做第 4 步的实验，把结果告诉我。不要在没验证假设的情况下继续改代码。
```

> 这套提问的价值在参考实现的性能诊断中被验证过：一个关掉后台预热的 A/B 对照实验，
> 直接把问题从"感觉哪都慢"锁定到 1240 倍的单点。**对照实验的信息量远高于继续读代码。**

---

## 9. 反漂移检查清单

每 2–3 个里程碑跑一次，防止累积偏移：

```
做一次跨模块一致性审查，不写代码。

1. 把 openspec/contracts/data-model.md 里定义的所有类型名列出来，
   然后 grep 代码库，找出：
   - 定义了但没被任何地方使用的类型
   - 代码里存在但契约里没有的类型
   - 同一概念用了两个不同名字的地方

2. 把 openspec/contracts/api.md 里的所有端点列出来，对照 server/server.ts，
   找出：漏实现的、多出来的、路径或参数不一致的

3. grep 全库检查这四个模式，列出所有命中位置：
   - "SELECT \*"
   - "spawnSync" / "execFileSync"
   - ".map(" 后面跟 "fetch(" 的
   - "catch" 块里是空的或只有 console 的

输出一张表：问题 | 位置 | 严重度 | 建议。不要自动修复。
```

---

## 10. 常见失败模式与对策

| 失败模式 | 表现 | 对策 |
|---------|------|------|
| 编字段名 | 用了 `sessionKey` 而契约是 `sessionId` | 每个任务重贴对应契约章节；review 时 grep 类型名 |
| 偷偷改测试 | 测试全绿但断言被改松 | Review 提示词第 1 项；每次看 `git diff *.test.ts` |
| mock 掉真实逻辑 | 集成测试绿，手跑不通 | 明确禁止 mock fs / child_process / sqlite |
| 悄悄加依赖 | package.json 多出 lodash / express | AGENTS.md 写死 4 个依赖；review 检查 diff |
| 一次做太多 | 一个 prompt 让它做 3 个模块，全部半成品 | 严格按里程碑，一次一个；adapters 一次一个 provider |
| 优化掉 gotcha | "我把这个奇怪的 /2 去掉了，更清晰" | AGENTS.md 明确：gotcha 照做不要优化 |
| 上下文过载 | 后半程开始前后矛盾 | 单任务控制在 900 行内；长会话及时开新的 |
| 忽略性能 | 功能全对但首屏 5 秒 | nfr.md 断言进 CI；每里程碑跑性能检查 |

---

## 11. 一页速查

```
开新里程碑：
  1. 看 BOOTSTRAP.md 找到该 M 的「读」「产出」「验收」三栏
  2. Codex 跑 §3.1 写测试
  3. DeepSeek 跑 §3.2 写实现
  4. Codex 跑 §6 review
  5. M3 之后加跑 §7 性能检查
  6. 全绿才提交，提交信息 `M<n>: <模块> — <一句话>`

每 3 个里程碑：跑一次 §9 反漂移检查

卡住：用 §8，先做实验再改代码
```
