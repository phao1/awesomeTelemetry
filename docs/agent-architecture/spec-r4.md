# Agent 架构决策 · 规格 r4（PRD + 实现计划）

> 2026-10-30。**本文是这项功能的唯一权威来源。**
> - [`docs/agent-boundary-decision-prd.md`](../agent-boundary-decision-prd.md) 和 [`docs/agent-boundary-decision-design.md`](../agent-boundary-decision-design.md) 只作背景参考；和本文冲突时，以本文为准。特别是：那里的新 `agent-boundary` 模块、`ab_*` 表和 `/api/agent-boundary/*` 路由**都不做**。
> - 线框：[`wireframes/`](wireframes/README.md)。
> - 方法依据：[Anthropic 文章](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)，以及仓库里固化的 [single-agent-loop-kit](../../data/agent-folding/single-agent-loop-kit/README.md)（@c437962，Apache-2.0）。

## 1. 产品

**一句话**：用 Claude Code、Codex、OpenCode 的真实运行记录，按文章和 kit 的方法，判断每个子 Agent 应该折回、合并、改成工具调用还是保留；改完之后，用分组对比验证有没有变差。

| 项 | 内容 |
|---|---|
| 用户 | 基于这三个工具搭多 Agent 系统的构建者 |
| 价值 | kit 的门槛是要自己导出 trace、自己有评测。telemetry 本来就有 trace，也能跑评测，所以把「审计 → 基线 → 改一处 → 对比」做成点几下就能走完的流程，每个数字都能点回原始事件 |
| 方法 | 完全沿用 kit（§3）。kit 被当作「方法和格式的标准」，不要求由 Claude 驱动 |
| 入口 | **不加顶层菜单**，全部在任务中心：任务页「架构」页签（线框 ③）、任务列表「架构概况」抽屉（①②⑥⑦）、任务列表多选 A / B →「对比」（④⑤） |
| 不做 | 自动改用户代码、自动跑付费评测、跨工具排名、把单次观察说成已证明的收益；不改任务模式实验和评测中心的入口；不改兼容统计 ▸ 对比（会话级一对一） |

## 2. 现状和总体做法

`agent-folding` 模块已经是 kit 的 TS 版：
- 数据模型 `FoldingProject`：Agent、边界、题目、流量、实验、运行、证据、人的决定；
- `analyzeFoldingProject`：耦合和链覆盖；
- `estimateFoldingPlan`：Token 估算；
- `runner` / `external` / `anthropic`：隔离运行；
- `scripts/import-single-loop-kit.mjs`：导入 kit 示例数据。

它缺两样东西：
1. **没有接上真实数据。** `server/agent-folding/native.ts` 只处理单个任务，`traffic` 为空，非主成员一律默认判成 `as_tool`。
2. **没有放进任务中心。** 现在只能从「任务模式实验」进入 `AgentFoldingWorkbench`。

**总体做法：在 `agent-folding` 上补全，不新建平行模块。** 公式只有一套：
- 判定和对比沿用 kit 的规则；
- 指标沿用 `src/core/benchmark-analysis.ts`。

## 3. 方法（必须与 kit 一致）

- **判定词**：`main` / `fold` / `merge`（附对方）/ `as_tool` / `keep`，外加 `insufficient`（证据不足，我们自己加的）。现有 `FoldingAction` 增加 `insufficient`，并更新契约。
- **默认判 `fold`。** 只有满足下列一条，才判 `as_tool` 或 `keep`，并写出具体数值：
  1. 读得远多于主 Agent 之后需要的（kit 的经验值：每次读入上万 token 算，几千不算）；
  2. 并行，或独立验证；
  3. 工具过载或指令冲突，而且 skill 解决不了。这一条规则看不出来，只能列为「问负责人」。
- **kit 明确排除的理由一律不计入**：不同团队负责、有自己的人设、提示词长、工具多、步骤固定。
- **`keep`** 只用于：必须自己和用户多轮对话，或者由外部控制（另一家公司、合同、监管）。这两点从 trace 看不出来，由用户在清单里标注。
- **合并候选**：和 kit `coupling_map.py` 的口径一致，默认 `min-coupling 0.5`、`min-share 0.05`，可调。
- **调用链覆盖**：和 kit `chain_coverage.py` 一致。生产中出现过的每条子 Agent 链（默认 `min-traces 2`），评测里都要有一道题走过它。
  - 注意和「关联完整度」区分：后者是「能确认父子关系的委派占比」，是数据质量指标，两者都要有。
- **对比结论**：和 kit `compare.py` 一致。B 完成的任务比 A 少，改动就不成立，均值提升不能抵消。写入动作（actions）有变化的题目要单独列出，即使分数没变。没有单价就不显示费用，从不猜价格。
- **阈值**：所有我们自己设的阈值（比如读入:返回的比值）都是启发式默认值，要能配置、带版本，并且不能说成是文章给出的公式。

## 4. 指标（对比报告必须包含，线框 ⑤）

**所有公式只有一份实现**：把任务转成评测运行的形状，然后调用 `benchmarkMetrics()`、`correctedUsage()`、`benchmarkStats()`。**不要复制公式。**

| 组 | 指标 |
|---|---|
| 标识（用来分组，也用来判断两组之间改了几处） | 产品（工具和模式）、环境、模型（实际调用的）、题目 ID（case ID，没有时用输入指纹）、执行机 |
| 结果 | 通过用例 / 总数、通过率、是否成功（没有验收结果时为「未知」）；LOC、漏洞、函数重复率、平均圈复杂度、冗余、编译告警、静态告警、Critical / Major / Minor / Suggestion（照原样导入，不重算） |
| 时延 | E2E、TTFT、TPOT、模型调用次数、单次推理平均耗时、模型总耗时、工具调用次数、单次工具平均耗时、工具总耗时 |
| Token | 输入、输出、思考、缓存读、缓存写、缓存（读 + 写）、Token 总消耗（修正）、缓存命中率（**只算缓存读，写入不算命中**） |
| 派生 | 未缓存输入、每个通过用例消耗的 Token、每千行静态告警、E2E 拆解（模型、工具、其余各占多少）、子 Agent 数、委派次数、子 Agent 占比、主 Agent 等待、关联完整度 |

**计算规则：**

- **任务的范围**：根会话加上全部能关联上的子会话。
- **TTFT / TPOT** 只取关联到这次调用的代理抓包实测值。没有抓包时为「未知」，**不用** `speed-metrics.ts` 里的旧推算值。
- **`correctedUsage` 做两处最小修改**（评测中心也会跟着变，要补测试，原有测试必须全部通过）：
  - ① `outputIncludesReasoning === true` 且思考数为 `null` 时，不再让总量变成 `null`；
  - ② `BenchmarkUsage` 增加 `cacheWriteReported`。为 `false` 时，缓存写按 0 计算，界面注明「该工具不单独报告缓存写入」。
- **各工具的口径**（输入是否含缓存、输出是否含思考、是否报告缓存写入）必须在 P0 用真实记录核实，写进 `openspec/research/agent-architecture-evidence.md`。
- **组内汇总**：n、均值、中位数（排在前）、最小–最大、CV。n < 2 时标「单样本」；CV > 30% 时标「组内波动大」。
- **组间**给出 B − A 和 B / A。以下情况该行标「不可比」，不给差值：两组口径标记不同、TTFT 来源不同、代码质量的扫描器不同。
- **改了几处**：比较两组的产品模式、环境、模型、定义指纹、主指令文件、工具权限、验收来源、CLI 版本。多于 1 处时，结论为「有混杂」。
- **缺失就是「未知」**，不显示 0。
- **验收导入格式**：沿用评测中心的 verdict 格式（`passed`、`total`、`quality`），另加 `qualitySource` 和标签（产品、环境、执行机、case ID），并支持逐用例结果。缺少逐用例结果时，报告写明「无法判断有没有用例从通过变失败」。

**测试数据**：用用户提供的 ruoyi-perf-management 三组 × 3 次数据（线框 ④⑤ 里的数字），做成 `src/core/__fixtures__/` 下的 fixture。每个指标的单次值、中位数、CV 都要和手算一致。

## 5. 实现阶段

每个阶段结束都要停下，按 `AGENTS.md` 的交付格式汇报，等确认后再进入下一阶段。

### P0 修数据（必须最先做）

- 用本机一次真实的 Claude Code 子 Agent 运行，核实：子 Agent 会话文件里写的是父会话的 `sessionId`，导致父子关系建不起来。现状：`src/adapters/claude-code.ts` 中 `isSubagent` 固定为 `false`。
- 修复父子关联（`src/adapters/claude-code.ts`、`local-sessions/claude.ts`，必要时还有 `src/adapters/native-identities.ts`），加脱敏 fixture。
- Codex（`parent_thread_id`、`thread_spawn`）和 OpenCode（`parentID`）只核实，必要时才改。
- 核实三个工具的 Token 口径。
- 产出：`openspec/research/agent-architecture-evidence.md`。**真实内容不得提交。**
- **本机没有子 Agent 运行记录时，停下来请用户提供，不要编造。**
- 验收：三个工具都能建立主子关系；关联完整度能算出来。

### P1 接真实数据

- 新增 `server/agent-folding/native-scope.ts`：按范围（工具、项目、时间，或一组根任务）生成一个 `FoldingProject`。
  - Agent 按定义名（Claude Code 的 `subagent_type`、Codex 的角色、OpenCode 的 agent 名）跨任务合并；
  - 每次委派写成一条 `traffic`（`traceId` = 根任务）；
  - 证据带上原生定位（`native.taskId`、`sessionKey`、`eventId`）。
- 单任务的 `native.ts` 保留。
- **先不加新表。** 按范围生成的结果要有缓存，以会话修订号失效。只有性能超出 `openspec/contracts/nfr.md` 的预算时，才停下来提出加索引表。
- 验收：用真实数据算出耦合图和合并候选，每个数字都能点回原始事件。

### P2 判定规则

- 新增 `src/core/agent-folding-rules.ts`，实现 §3 的判定。去掉「非主成员一律 `as_tool`」。
- 每个判定附：满足或不满足哪条理由、数值、阈值、样本数、反证、置信度（代码和 trace 都支持为 high，只有一边支持为 medium，只是推测为 low）。
- 验收：每种判定至少一个正例、一个合理的反例（例如独立审查者重复读取，但确实发现了问题）、一个证据不足的例子。

### P3 和 kit 对拍

- 耦合、链覆盖、前后对比、估算这四项，在 TS 里的结果必须和 kit 的 4 个 Python 脚本逐项一致。
- 新增 `scripts/kit-parity-golden.mjs`：在仓库里固化的 kit 示例数据上运行 Python 脚本（`coupling_map.py` 有 `--json`；其余脚本解析输出，或者只对齐关键数字），把结果存成 golden 文件提交。之后的测试只读 golden，**跑测试不需要装 Python**。
- 对比结论补上 kit 的「完成的任务变少即不成立」和「写入动作变化」。
- 验收：对拍测试全部通过。有任何不一致时，先停下报告差异，不要改 golden 去迁就实现。

### P4 与 kit 互通

- **导出**：`traces.jsonl`（`coupling_map` 格式）、`results.jsonl`（build-eval 布局：`prompt_id`、`grade`、`latency_s`、`in_tokens`、`out_tokens`、`model_calls`、`by_agent`、`actions`）、`inventory.tsv`、`PLAN.md`。
- **导入**：`PLAN.md` 的进度、`inventory.tsv` 的判定和人填的列（负责人、是否直接对用户说话、对应哪个评测）、各版本的 `results.jsonl`（作为 A / B 组）。
- **CLI**（`server/agent-folding/cli.ts`，命令 `telemetry-agent-folding`）增加只读子命令：`coupling`、`coverage`、`compare`、`estimate`、`export`。这些命令读本地数据库，不运行任何东西；现有的 plan / `--execute` 行为保持不变。
- 验收：用 kit 原版脚本处理我们导出的文件，结果和 telemetry 页面上一致。

### P5 指标与报告

- 新增 `server/agent-folding/run-metrics.ts`：把任务转成 `BenchmarkRun` 的形状。
- 新增 `src/core/agent-folding-metrics.ts`：派生指标、组内汇总、组间差值、可比性、改了几处。
- 修改 `correctedUsage`（§4 的两处）。
- 新增 `src/core/agent-folding-report.ts`：生成 HTML、Markdown、CSV 三种报告，HTML 复用 `src/core/compare-report.ts` 的外壳。所有文本做转义，报告里不放会话正文。
- 验收：§4 的 fixture 测试通过；导出的三种格式章节顺序和线框 ⑤ 一致。

### P6 放进任务中心

- `src/task-route.ts`：`TaskMode` 增加 `'architecture'`；增加概况抽屉和对比视图的路由字段。非法值丢弃；每组 ≤40 个任务时，对比写进地址（可以收藏）。
- `TaskWorkbench.tsx`：
  - 加「架构」页签（③）：打开任务时后台计算，只读本地记录，不调模型。`ArchitectureDiagnosisPanel` 挪进这个页签，组件本身不改。
  - 任务列表加多选和 A / B 操作条（④）。
  - 加「架构概况」抽屉（①②⑥⑦），复用 `AgentFoldingWorkbench` 里能拆出来的部分。
  - 加对比视图（⑤）。
- 任务模式实验、评测中心的结果页加「在任务中心对比」。官方示例工作台保留在原入口。
- 验收：在浏览器里用真实数据走完 审计 → 判定卡 → 多选对比 → 导出报告，并截图。

### P7 AI 复核

- 对选中的一条边界，用用户自己配置的模型做语义复核，生成迁移草稿：skill、工具说明、返回结构（参考 kit 的 `templates/`）。
- 复用 `server/agent-folding/anthropic.ts` 的连接和密钥处理。
- 发送前可以预览和删减证据；模型的结论只能引用证据包里的 ID；手动触发；用量单独显示。
- 验收：提示注入测试、虚构引用测试通过。所有测试用本地替身服务，不发真实付费请求。

## 6. 全程约束

- 遵守 `AGENTS.md`：契约优先；新增字段、路由、类型先写进 `openspec/contracts/agent-folding.md`、`api.md`、`data-model.md`（必要时还有 `nfr.md`），再写代码；测试放在源文件旁边；不放宽断言；不 mock 被测逻辑；预算是硬要求。
- 监控、代理、Frida 默认关闭。本功能的任何操作都不会启动它们，也不会调用模型，P7 手动触发的复核除外。
- **不得 reset、checkout、stash、覆盖或删除**现有改动。
- kit 的代码按 Apache-2.0 移植，在文件头注明来源，保留 `data/agent-folding/NOTICE.md`。kit 的示例数据只用于演示和对拍，不当成真实生产数据。
- 每阶段结束运行 `npm run typecheck`、`npm run test`、`npm run lint`；P5 和 P6 结束时另跑 `npm run build`、`npm run perf:check`，结果追加到 `PERF-BASELINE.md`。
- 每个阶段在本地分支上单独提交一次，提交信息沿用仓库格式（如 `M12: agent-folding — …`）。**不要推送。**
