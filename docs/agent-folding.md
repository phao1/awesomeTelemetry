# 逐 Agent 判断：合并、折叠、作为工具或保持独立

这个工作台回答的是“某个分工边界是否值得保留”，而不是给单 Agent、多 Agent、Team
排一个通用名次。入口仍是顶部「任务模式实验」，原来的整体模式比较保留在高级折叠区。
监控、代理和 Frida 默认关闭；查看、导入和分析不会调用模型或重新执行工具。

## 依据与实际接入

已逐项核对 [Anthropic 原文](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop)
及其 [single-agent-loop-kit](https://github.com/anthropics/single-agent-loop-kit)。本地固化的
参考版本为 `c43796287b83bec847db923f07131d1cc8de750d`，保留 Apache-2.0 LICENSE、原始
文件、哈希和来源链接。可用 `scripts/import-single-loop-kit.mjs <pinned-checkout>`
重新生成数据；导入脚本不调用模型。

工作台直接载入两个官方公开的历史模型实验，共 **132 条运行记录、19 个现有任务定义、
1,460 个轨迹事件**。其中第一实验为 12 个任务 × 2 次重复 × 2 个版本；第二实验为
17 个任务 × 2 次重复 × 2 个版本，另保留 t01/t10 的每侧 4 次补跑。两个实验的
baseline/v1 分别命名，不混成同一组。独立任务与单任务内的断言分别计数。

官方提供的 200 条“生产式流量”是固定种子生成的虚构数据，共 322 次子调用；它用于
展示耦合分析，不能冒称企业真实生产样本。公开实模型日志也只覆盖一个人、一个记录为
`claude-opus-5` 的模型和一个虚构客服系统。当前模型是否可用需由用户实际配置，不能
从历史名字推断。原运行的若干 commit 仅保存在记录里，不在这个公开仓库的初始提交
历史中；当前权限、计量、提示词及部分任务又在实跑后改动，不能声称已原样复跑旧版本。

## 从官方实例得到什么结论

| 边界 | 审计建议 | 已有实测能支持到哪里 |
|---|---|---|
| orders + shipping | 合并专长，再评估折成一个 `track_order` 工具 | 生成样本中 shipping 的 96/200 条链都紧接 orders；这是候选。尚无该合并本身的真实对照，不能直接批准 |
| returns | 将领域流程折为 skill＋工具，并把退货政策放进执行层 | 首轮总体 22/24→23/24，平均延迟约 27.3→19.4 秒，但 t01 有 1 次通过→失败。**阻止直接采纳，先修邻域回归** |
| account | 薄包装可折成直接工具，不必硬造 skill | 身份与地址隐私应由工具约束；缺 account-only 实测，需要补基线与对照 |
| diagnostics | 保留独立日志上下文，作为结构化工具供主循环调用 | 官方首轮 32/34→31/34，t01 仍退步；补跑虽保留了变更，t10 的额外订单路径和成本仍值得检查。人的 keep 不等于已证明收益 |
| claims | 保留独立对话和完整交接 | 虚构保险方拥有这一流程并直接多轮澄清；不能把外部控制权当成内部可随意折叠的模块 |
| router/main | 保留统一主循环与端到端责任 | 主提示或工具目录一变，邻域任务也受影响，需要全链验收，不能只测试被改的专长 |

returns 实验的 t01 失败轨迹只有 `router.get_order`，随后回答订单已寄出、没有送达日期，
没有再询问 shipping。原本依赖物流查询的最终事实没有保住。工作台可以从回归任务点到
具体重复轮次、失败的日期断言和原始工具结果，看到这个机制变化，而不是只看到总分。
[失败原文](https://github.com/anthropics/single-agent-loop-kit/blob/c43796287b83bec847db923f07131d1cc8de750d/examples/support-desk/example-run/results/v1/traces/t01_rep1.json)

在 diagnostics 实验首轮加补跑的全部 6 次 t10 中，双方任务都通过，但 orders 出现次数
从 1/6 变为 5/6；t10 平均延迟约 25.81→35.47 秒，输入约 8,089→10,722 Token。
这是“最终结果相同，过程变贵”的例子。它不证明额外查询一定无用，应打开参数与结果
核对；也不能把所有 17 个任务都伪装成做了 6 次重复。

## 实际使用顺序

1. **选来源。** 可加载官方留存模型实验，导入自己的 portable project JSON，或选择
   当前已采集的原生任务。原生读取保留准确事件/捕获/逻辑调用定位，只创建候选清单，
   不凭日志生成正确答案或成功分数。
2. **审计每个角色与边界。** 核对 owner、提示词、实际工具、交付物、直接对话、外部
   控制权和独立上下文理由。工具多、团队不同、角色人设或提示词长都不是独立的充分理由。
3. **建立共享任务集。** 一个 case 是独立输入和初始状态，可含多轮用户消息。成功标准
   是该 case 内的 checks。覆盖实际顺序链、不可违反规则、跨域路径和不开心路径；另留
   不用于训练反馈的确认集。没有标准就先补标准，不能从总 Token 推算任务是否正确。
4. **一次改一处。** 合并一对专长、折一个 skill＋tools、或改成 agent-as-tool。固定其余
   模型、工具权限、预算、环境、评分器和非目标角色。主循环工具目录变化要检查所有邻域。
5. **重复对照并追踪过程。** 逐 case/rep 看通过→失败、失败→通过、缺失和 harness 错误，
   再看真实输入、工具发现/加载/调用、完整动作参数、对话和交接。链覆盖按单次运行顺序
   检查，不把不同重复的 A 与 B 拼成 A→B；路径出现和终端事实通过分别显示。
6. **决定下一步。** 审计候选与实验状态分开。任何已有任务回归都会阻止自动采纳；总体
   平均提高不能抵消。至少三次完整可比真实重复、相关链和确认集齐备，才可能显示本任务
   支持。技能折叠还有保留工具、去掉 skill 的单独消融；纯工具薄包装可以明确不适用。
   人可以记 keep/revert/fix/rerun 和原因，这条记录不会覆盖测量事实。

任务等权成绩先在每个 task 内求重复均值，再对 task 等权汇总；原始通过次数也展示。
95% 区间注明独立任务假设，不把同一任务的多个断言当成额外样本。跨配置的结论只适用于
该任务/模型/工具/版本范围；它不是针对所有企业的因果结论。

## 为什么比直接读 kit 脚本多一层

原 `compare.py --fail-if-worse` 可能在“总分上涨但某个任务退步”时返回成功。原路径
摘要只看 by_agent 是否出现，写入摘要只看 action.name；链脚本还会跨重复合并 agent
集合。这里保留每次重复的顺序、完整动作参数、具体失败 checks、预期分母与缺失记录，
并让任何单任务回归优先于均值。生成流量只是审计线索，不能盖过真实对照的反例。

旧日志的 tool_result 有些只留 2,000 字符，也没有逐事件时间戳或 call ID。界面使用
顺序轨迹，明确显示截断；不伪造耗时、完整模型上下文或显式接收确认。真实 API 新运行
则由执行层保存本地逐调用、工具与验收证据，嵌套 Token 计入共同预算。

## 运行与 API

免费离线按钮只运行固定虚构客服任务，使用关键词站位来验证工具循环、技能加载、
写入门、轨迹、取消和保存流程。**它没有模型质量分数，不能用来证明合并更好。**

命令行默认仅校验具体计划和估算，不执行：

```bash
npm run agent:folding -- config/agent-folding.example.json
npm run agent:folding -- config/agent-folding.example.json --execute --output ./folding-results/smoke-001
```

真实 Anthropic 计划需要明确模型、进程环境里的 `ANTHROPIC_API_KEY`，并同时加
`--execute --allow-paid`。浏览器不接收密钥，不提供任意真实执行入口。当前机器没有发现
可用认证，本次交付没有新发起付费模型调用；本地 HTTP 协议测试不冒称 vendor 实跑。

直连使用 Node 原生 fetch 调 `POST /v1/messages`，正确保留工具结果关联、模型返回名与
输入/输出/缓存口径。local `load_skill` 与托管 Skills API 不同；tool search 的 deferred
loading 控制进上下文，完整工具 Schema 仍随请求提交。并行只读工具有上限，写操作顺序
通过门禁；硬权限/退货政策可直接绕过模型调用测试，不能仅靠模型“自觉遵守”。

[Messages API](https://platform.claude.com/docs/en/api/messages/create)、
[Tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)、
[并行工具](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use)。

每 case 有墙钟、调用数、每请求输出、输入字符、工具批次和实测总 Token 预算，嵌套调用
共同计量。实测 Token 在响应后才能扣除，因此它不是精确账单上限；不会猜价格或把估算
当成发票。Admin 账单汇总、异步 Message Batches、API Skills/code execution 是不同的
接口，不能用它们代替逐 Agent 的当前运行归因。

`/claude-api build-eval`、`hillclimb`、`prompt-audit`、`cost-optimize` 是 Claude Code
的工作流命令。导出的迁移材料提供接入配方；这里不会虚构四个可直接调用的评测 HTTP
API。真实优化还须隔离 train/confirmation，不能反复用公开确认任务挑版本。

[命令说明](https://code.claude.com/docs/en/skills#work-on-claude-api-projects)、
[Token 估计](https://platform.claude.com/docs/en/build-with-claude/token-counting)。

## 接自己的系统

导入架构清单或从原生任务建立候选后，可以新增独立评测任务、多轮输入与成功标准。
外部驱动表单填写本地 Git 仓库、ref、baseline/candidate argv 和独立 evaluator argv。
导出的计划携带该项目自己的图、cases 与来源，不会替换为官方客服图。

外部 adapter 复用现有独立 Git 工作区、argv 无 shell 执行、进程组取消和独立验收流程，
每个 case 单独运行。驱动通过 `BENCHMARK_CONTEXT` 读取任务和运行路径，写标准遥测与
协作证据；evaluator 单独获得 `TEAM_EXPERIMENT_CASES_PATH`。驱动预置的验收文件会
先清掉，遥测坏了也仍跑独立 evaluator。模型与内部预算未能独立验证时如实保留未知。

逐 check 扩展：独立 evaluator 的该 case detail 可以是 JSON 字符串，内容为
`{"folding_checks":[{"id":"<canonical checkId>","passed":true}]}`。必须完整覆盖固定
check IDs，且与 case/aggregate verdict 一致；普通旧式 case-level detail 只提供 case
结果，不被伪造为每条断言均通过。具体 legacy 协议参见[任务模式实验](team-experiment.md)。

导入内容始终标为用户自报，不自认证为官方或本地可信抓取。文件路径、URL、Python
字典字符串和代码片段仅作为文本，不 eval，不执行导入脚本。工具参数缺失就是未知，
不会凭同名补造 Schema。

## 导出与维护

可导出 portable project、具体实验计划、人类决策记录和迁移材料。材料包括 inventory、
逐边界方案、共享任务/确认任务、实际保留的工具 Schema、skill 草案、结构化返回 Schema、
owner/upkeep 约定和下一步 CLI 配方。缺原始 Schema/权限约束会明确留空，不伪造完整性。
所有内容可审阅；不会自动改写用户的 Agent 仓库或应用某个回退。

容量和验证契约见 [agent-folding.md](../openspec/contracts/agent-folding.md) 与
[spec](../openspec/specs/agent-folding/spec.md)。历史原生过程诊断仍有自己的覆盖限制，见
[过程证据说明](architecture-diagnosis.md)。

### Architecture r4: kit interchange and read-only commands

`traces.jsonl`, `inventory.tsv`, `PLAN.md`, and
`results/<experiment>/<variant>/results.jsonl` are included in artifact exports.
The trace/result layouts work with the pinned kit Python scripts. Numeric trace
`ts` means sequence ordering when native timestamps are absent, not measured time.
Missing grade, action or agent evidence stays unknown. Importing inventory or
plan checkboxes does not certify an evaluation or execute the plan.

After a normal build, inspect an already collected local database:

```sh
node bin/agent-folding.js coupling --db /path/to/state.sqlite --scope scope.json
node bin/agent-folding.js coverage --db /path/to/state.sqlite --scope scope.json --before baseline/results.jsonl
node bin/agent-folding.js compare --db /path/to/state.sqlite --scope scope.json --before baseline/results.jsonl --after v1/results.jsonl
node bin/agent-folding.js estimate --db /path/to/state.sqlite --scope scope.json --before baseline/results.jsonl --reps 2
node bin/agent-folding.js export --db /path/to/state.sqlite --scope scope.json --output /path/to/new-review-directory
```

A scope selects one provider (`claude` or `codex`), optionally `cwd`, UTC `from` /
`to`, or up to 40 collected root `taskIds`. Empty and mixed-provider scopes fail
with a request to narrow/select the scope. These commands open SQLite readonly;
they never scan, monitor, start capture or execute a model/evaluator. Only export
writes files, exclusively inside a new destination. Existing plan.json and
explicit `--execute` behavior is unchanged. OpenCode verification is deferred.
