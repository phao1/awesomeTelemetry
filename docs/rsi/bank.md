# RSI 自建题库

M13 / P3，接口以 `openspec/contracts/rsi.md` RSI-011 为准。三十个小型代码库、题面、测试与参考解均为本次原创，无外部代码或运行时依赖。所有题仅使用标准库；Python 使用兼容 Python 3.9 的语法，Go 模块无外部依赖。JavaScript 使用原生 ES modules 和 node:test，未包含 TypeScript 题。

## 集合与分布

固定 seed：`rsi-p3-2026-11-07-v1`。每个语言/难度层按 SHA256(`${seed}:${questionId}`) 十六进制升序排列，再按下表配额分配 train、sealed、final。smoke 在每种语言的 train 中按 SHA256(`${seed}:smoke:${questionId}`) 取最小者。集合内部按题号排序。`validate.mjs` 独立重算分配，seed 或集合被误改会失败。smoke 是 train 的子集，总题数为三十，不把 smoke 重复计数。

| 集合 | JavaScript easy/medium/hard | Python easy/medium/hard | Go easy/medium/hard | 合计 easy/medium/hard | 题数 |
| --- | --- | --- | --- | --- | ---: |
| smoke（train 子集） | 0/0/1 | 1/0/0 | 0/1/0 | 1/1/1 | 3 |
| train | 2/2/1 | 2/2/1 | 2/2/1 | 6/6/3 | 15 |
| sealed | 1/1/1 | 1/1/1 | 1/1/1 | 3/3/3 | 9 |
| final | 0/1/1 | 0/1/1 | 0/1/1 | 0/3/3 | 6 |

smoke：python easy, go medium, javascript hard；其余每题所属集合见下方题目目录（由 manifest 决定）。easy 是单文件小改；medium 包含边界、顺序、Unicode、溢出或输入所有权；hard 需要理解入口、策略和状态模块的关系。设计目标是熟练编码 Agent 在五至十分钟内修复；尚未跑模型试做，难度标记是工程判断，不能冒充实测通过率。入库前仍需人工抽查与试做校准。

## 运行与判定

```sh
node scripts/rsi-bank/mutate.mjs
node scripts/rsi-bank/validate.mjs
npx vitest run --configLoader native --no-cache scripts/rsi-bank
npx eslint scripts/rsi-bank
# 由沙箱外执行；须预先准备镜像，不会拉取镜像：
node scripts/rsi-bank/mutate.mjs --docker
node scripts/rsi-bank/validate.mjs --docker
```

本地模式使用当前 Node、python3、go 和 git；缺少工具链会逐题打印 SKIP，并在最终 JSON 列出 skipped。SKIP 不表示验收通过。首次本地交付时 Go 未运行，manifest 中其 `mutationKillRatio: 0` 表示尚无有效测量，不能视为已入库合格。容器补跑后脚本更新 manifest 与下方结果。已测得的 Go 数据在后续本地跳过时保留。没有新增契约外字段来编码状态，执行状态在本文件与脚本输出中说明。

Docker 使用异步 CLI，镜像为 node:24-bookworm-slim、python:3.9-slim、golang:1.23-bookworm；`--pull=never`、无网络、只读根文件系统，临时工作目录单独挂载，报告器只读挂载。没有凭据、用户配置或题库整体挂载。这里只运行作者提供的代码和变异，不是用于运行不可信 Agent 补丁的完整安全边界。当前环境禁止 Docker，因此 Docker 路径未验证。每题单独挂载临时 Go 缓存，变异之间复用编译缓存。Go 启动编译计入每次三十秒超时；冷缓存或慢机器若超时，应作为执行异常排查，不能当成杀死变异。

校验为每题建立独立临时副本，应用 `reference.patch` 后再覆盖隐藏测试。不初始化 git 仓库、不修改工作树、不绑定端口。基线必须实际执行全部测试且至少一例失败；参考解必须实际执行全部测试并通过。node 通过题库外生成的 node:test 事件报告器计数；Python 使用题库外 unittest 报告器，Go 消费 `go test -json`。核对用例总数、唯一名称和 meta 列出的名称，跳过测试不能冒充通过。报告器由校验脚本持有，题目中没有自报分数的 runner。

变异只覆盖参考补丁新增或替换的源代码行：比较与逻辑运算翻转、算术正负翻转、整数边界加减、整条语句删除。字符串字面量不变异，去重后逐一执行。有效变异必须执行完整测试集合；编译/语法/导入失败、缺用例单独记 invalid，不计入分子或分母；只有可信报告已确认进入 meta 列出的测试后，变异运行超时才计为 killed（捕获死循环）；编译或测试启动阶段超时、进程启动失败、输出超限视为运行不完整，不能计作 killed。包括测试内超时的比例为 killed/(killed+survived)，必须有有效变异且达到 manifest 的 mutationKillMin（默认 0.7）。低分题返回非零并保留实际低分，必须加强测试或替换题目后重跑；不自动删除题目破坏集合配额。存活变异列在结果表，可能包含等价变异，未主观扣除。

元数据包含真实隐藏测试名、全部 repo 与 hidden_tests 的相对文件路径、真实断言诊断罕见字符串以及断言预期值的源码表示（JavaScript/Python 使用 JSON，Go 使用 Go 字面量）。null、布尔常量和空字符串等不具辨识力的通用预期没有作为指纹来源；其余预期逐值记录。题面不包含这些私有指纹、题号、仓库名、参考补丁或测试内容。指纹字段用于已有纯函数 buildFingerprintDictionary，不改 src 核心规则。字典只检测约定的文字指纹，不声称阻止任意语义作弊。

## 已知局限

- **难度未经真实模型校准。** 标为 hard 的题也只是两三个文件、几行修复。如果模型很强，基线可能接近满分，闸门就测不出提升。接入模型后要先看基线通过率，太高就加难度或换模型。
- **题目风格高度一致。** 题面句式、文件名（如 `logic.*`、`Evaluate`）相似，封存集也是同一风格。优化者针对这种风格过拟合时，封存集可能查不出来，要靠对抗变体题和外部真实题来补。
- **变异检查只覆盖参考解改动的行。** 比例高说明测试抓得住参考解附近的错误，不代表能拦下所有错误思路。有的题有效变异很少（`rsi-dependency-waves` 只有 1 个），比例的统计意义有限。
- `--docker` 模式依赖宿主目录挂载，在 `--mount none` 的 RSI 虚拟机里不可用。请用 `scripts/rsi-bank/validate-in-container.sh`，它在一个容器里同时提供三种工具链。下方结果表的 Mode 列因此显示为 local，实际都在这个容器内运行。

## 题目目录

<!-- inventory:start -->
| Question | Language | Difficulty | Set | Smoke |
| --- | --- | --- | --- | --- |
| rsi-adjacent-labels | javascript | easy | sealed |  |
| rsi-atomic-transfer | python | hard | train |  |
| rsi-batch-tail | python | easy | train | yes |
| rsi-dependency-order | python | medium | sealed |  |
| rsi-dependency-waves | go | hard | sealed |  |
| rsi-escaped-columns | python | medium | train |  |
| rsi-expiry-edge | javascript | easy | train |  |
| rsi-interval-contact | go | easy | train |  |
| rsi-journal-replay | go | hard | train |  |
| rsi-latest-record | python | medium | train |  |
| rsi-lease-queue | python | hard | final |  |
| rsi-page-window | javascript | easy | train |  |
| rsi-prefix-removal | python | easy | train |  |
| rsi-query-multimap | javascript | medium | train |  |
| rsi-quota-buckets | go | hard | final |  |
| rsi-range-union | javascript | medium | final |  |
| rsi-retry-budget | javascript | medium | train |  |
| rsi-revision-view | javascript | hard | final |  |
| rsi-rolling-limiter | go | medium | final |  |
| rsi-rooted-path | javascript | medium | sealed |  |
| rsi-route-priority | javascript | hard | sealed |  |
| rsi-rune-runs | go | medium | train | yes |
| rsi-segment-prefix | go | medium | sealed |  |
| rsi-sorted-interleave | go | medium | train |  |
| rsi-stock-reservations | javascript | hard | train | yes |
| rsi-time-buckets | python | easy | sealed |  |
| rsi-ttl-lru | python | hard | sealed |  |
| rsi-uncovered-slots | python | medium | final |  |
| rsi-unicode-initials | go | easy | sealed |  |
| rsi-worker-count | go | easy | train |  |
<!-- inventory:end -->

## 变异检查结果

本地二十道 JavaScript/Python 题的参考解共运行一百五十五例隐藏测试，全部通过；对应原始快照均完整执行且失败。变异检查共杀死一百三十九个有效变异，无存活变异，另有二十五个无效变异不计分；二十题各自杀死率均为 1.0。首次本地交付时，Go 八十一例隐藏测试尚未执行；后续容器结果以下表为准。

结果由 mutate.mjs 实际执行后更新。pending 表示未运行；Invalid 不包含在杀死率中。最终准入还需 Go 容器检查和人工抽查。

<!-- mutation-results:start -->
| Question | Mode | Killed | Survived | Invalid | Ratio | Surviving mutants / status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| rsi-adjacent-labels | local | 8 | 0 | 1 | 1.0000 | none |
| rsi-atomic-transfer | local | 13 | 0 | 1 | 1.0000 | none |
| rsi-batch-tail | local | 2 | 0 | 1 | 1.0000 | none |
| rsi-dependency-order | local | 9 | 0 | 4 | 1.0000 | none |
| rsi-dependency-waves | local | 1 | 0 | 4 | 1.0000 | none |
| rsi-escaped-columns | local | 10 | 0 | 3 | 1.0000 | none |
| rsi-expiry-edge | local | 3 | 0 | 0 | 1.0000 | none |
| rsi-interval-contact | local | 15 | 0 | 5 | 1.0000 | none |
| rsi-journal-replay | local | 5 | 0 | 1 | 1.0000 | none |
| rsi-latest-record | local | 3 | 0 | 1 | 1.0000 | none |
| rsi-lease-queue | local | 13 | 0 | 2 | 1.0000 | none |
| rsi-page-window | local | 2 | 0 | 0 | 1.0000 | none |
| rsi-prefix-removal | local | 1 | 0 | 1 | 1.0000 | none |
| rsi-query-multimap | local | 4 | 0 | 0 | 1.0000 | none |
| rsi-quota-buckets | local | 9 | 2 | 10 | 0.8182 | reservations.go:8#10 replace <= with <; reservations.go:8#11 replace 0 with 1 |
| rsi-range-union | local | 14 | 0 | 1 | 1.0000 | none |
| rsi-retry-budget | local | 7 | 0 | 2 | 1.0000 | none |
| rsi-revision-view | local | 11 | 0 | 2 | 1.0000 | none |
| rsi-rolling-limiter | local | 4 | 0 | 4 | 1.0000 | none |
| rsi-rooted-path | local | 7 | 0 | 0 | 1.0000 | none |
| rsi-route-priority | local | 13 | 0 | 2 | 1.0000 | none |
| rsi-rune-runs | local | 6 | 0 | 8 | 1.0000 | none |
| rsi-segment-prefix | local | 9 | 0 | 4 | 1.0000 | none |
| rsi-sorted-interleave | local | 2 | 0 | 0 | 1.0000 | none |
| rsi-stock-reservations | local | 4 | 0 | 0 | 1.0000 | none |
| rsi-time-buckets | local | 2 | 0 | 1 | 1.0000 | none |
| rsi-ttl-lru | local | 10 | 0 | 2 | 1.0000 | none |
| rsi-uncovered-slots | local | 3 | 0 | 1 | 1.0000 | none |
| rsi-unicode-initials | local | 2 | 0 | 2 | 1.0000 | none |
| rsi-worker-count | local | 5 | 0 | 1 | 1.0000 | none |
<!-- mutation-results:end -->

## 被剔除的题

无。若本次实测出现低于阈值的题，先针对存活变异加强边界断言，再重新验证；未达标的题不能以完成入库交付。未执行的 Go 题是待验证题，不是已通过题，也没有被剔除。

## 沙箱检查记录

以下为首次本地交付的检查快照；后续容器重跑以最新变异表和脚本输出为准。

- `validate.mjs` 本地模式：二十题通过，十道 Go 题跳过；全部三十个参考补丁可应用，manifest、题面和元数据检查通过。
- `mutate.mjs` 本地模式：二十题达到阈值，十道 Go 题跳过；详细计数见上表。
- `npx eslint scripts/rsi-bank`：通过。
- `npx vitest run --configLoader native --no-cache scripts/rsi-bank`：七十二例通过，一例 Go 集成跳过。三十五例指纹测试、二十六例校验测试（含一例跳过）、十二例变异测试。
- 加跑指定的 `src/catch-guard.test.ts src/styles`：合计一百零六例通过、两例跳过；包含已有样式集成条件跳过。
- `npm run typecheck` 因只读 node_modules 中的 tsbuildinfo 写入遭 EPERM；按用户指定回退，分别执行 `npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile /tmp/rsi-p3-app.tsbuildinfo` 和 node 配置对应命令，均通过。

## 首次交付未运行项与限制

- Go 基线、参考解与变异：当前机器缺少 Go，由 Claude 在容器补跑。
- Docker 双模式实跑：沙箱禁止 Docker；需沙箱外执行上述命令。
- 模型五至十分钟试做、人工抽查、晋级闸门端到端评估：本次没有调用模型或运行评估服务。
- 全量 npm test、perf:check：由 Claude 在沙箱外按项目发布流程执行；本次只执行指定沙箱检查，不提交。
