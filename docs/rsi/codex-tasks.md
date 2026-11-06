# Codex 执行手册：本地 RSI

配套设计：[design.md](design.md)。每一节是一段可以整段交给 Codex 的指令，外加 Claude 审查时逐项核对的清单。P2 起的指令在启动前由 Claude 按 P0 实测和 P1 契约修订，以启动时的版本为准。

## 怎么用

1. 所有阶段基于 `dev1106-rsi`。Claude 为每个阶段建 worktree 和分支（`../rsi-pN`、`codex/rsi-pN`），`node_modules` 软链到主检出。
2. Codex 不提交。Claude 审查、跑沙箱外验证，再提交并合回 `dev1106-rsi`。不推送，不合并 `main`。
3. Codex 回复里出现 “Needs confirmation” 时，Claude 恢复同一会话作答，并要求它一次列出所有阻塞项。
4. 每个阶段都在用户能看到的终端标签里运行，保留日志。

顺序：P0 和 P1 可并行（文件不重叠）→ P2 和 P3 并行 → P2b → P4 和 P5 并行 → P6 → P7（Claude 联调）。

| 阶段 | 模型 | 强度 |
| --- | --- | --- |
| P0 环境探针脚本 | `gpt-6.1-sol` | `medium` |
| P1 契约和判定核心 | `gpt-6-astra` | `ultra` |
| P2 执行器 | `gpt-6.1-sol` | `high` |
| P2b Agent 档案 | `gpt-6.1-sol` | `high` |
| P3 题集 | `gpt-6.1-sol` | `medium` |
| P4 优化者接入和接口 | `gpt-6.1-sol` | `high` |
| P5 防作弊 Agent | `gpt-6-astra` | `ultra` |
| P6 页面 | `gpt-6.1-sol` | `medium` |

## 通用约束（已写进每段指令，这里集中列出便于核对）

- 先读 `AGENTS.md` 全文并遵守：十条禁令、五条必做、文档优先级、测试与源文件同目录。
- 不新增运行时依赖。容器靠异步调用 `docker` CLI，模型代理用 `node:http`。
- 只改指令列出的文件；需要额外改文件时先说明原因。
- 字段、路由、表、列名一律以 `openspec/contracts/rsi.md` 为准。契约没有的字段停下来问。
- 你的沙箱不能写 `.git`、不能绑端口、不能用 Docker、没有网络。不要提交。需要这些能力的验证写成脚本或标记为 `skipIf`，由 Claude 在沙箱外运行，并在输出里列出“未运行项”。
- Node：`export PATH="/Users/penghao/Documents/dshProject/dshPluginSecrete/.tools/node-v24.19.0-darwin-arm64/bin:$PATH"`。
- 沙箱内验证：`npm run typecheck`、`npx eslint <改动路径>`、`npx vitest run <改动路径> src/catch-guard.test.ts src/styles`。
- 沙箱里 `node_modules` 是只读软链，常规命令写缓存会 EPERM，这时用 `npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile /tmp/<名字>.tsbuildinfo`（`tsconfig.node.json` 同样）和 `npx vitest run --configLoader native --no-cache <路径>`，并在输出里写明。全量测试由 Claude 在沙箱外跑，改 schema 版本这类全局改动时，要主动搜出其他写死旧值的测试。
- 测试失败修实现，不放宽断言，不 mock 被测逻辑。
- 真密钥不写进仓库、日志、账本或任何容器（模型代理除外）。不读取、不挂载 `~/.codex`、`~/.claude`、`~/.ssh`。
- 界面和报告不出现金额，只有 token 和缓存命中率。
- 完成时按 AGENTS.md 的 Output format 输出（Delivered / Contract mapping / Needs confirmation），并一次列出所有阻塞项。
- 提交信息（Claude 负责）：`M13: rsi — <一句话>`。

---

## P0 环境探针

**分支**：`codex/rsi-p0`

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p0）。
本阶段只写探针脚本，不改任何运行时代码。你跑不了 Docker，脚本由 Claude 在沙箱外实测，所以脚本要自带清晰的报错和 JSON 报告。

目标：用一道小题验证 docs/rsi/design.md 的本地隔离方案在这台 M1 8GB 机器上可行，并回答“P0 必须回答的问题”。

必读（按顺序）：
1. AGENTS.md 全文
2. docs/rsi/design.md 的“开跑决定”“总体架构”“判题怎么防篡改”“轨迹与数据采集”“本地运行环境”“Codex 实施计划”
3. /Users/penghao/Documents/code/CodingAgent/opencode/opencode 的 AGENTS.md、package.json、packages/opencode 里的 flag 定义、config/provider 加载、run 命令、数据库路径（OPENCODE_DB）。只读，不要改。
4. local-sessions/opencode.ts 的 readOpenCodeDb；server/proxy/protocol-analysis.ts 的解析思路

只允许新增：
- scripts/rsi-probe/**（Dockerfile、脚本、假模型、代理、样题）
- docs/rsi/p0-runbook.md（Claude 按它逐步实测，写清每一步命令和预期输出）

结构（可微调，先说明原因）：
- colima-start.sh：启动专用 profile `rsi`（--vm-type vz --cpu 4 --memory 4），挂载范围尽量小。不用默认的整个 $HOME 挂载。stop 脚本同样提供。
- images/target.Dockerfile：从源码构建 OpenCode 2.1.3（bun 1.4.4），记录构建耗时和镜像大小。构建上下文只拷入 opencode 源码，不拷 .git 以外的本机内容。启动时不得需要网络：把 provider 依赖（@ai-sdk/openai-compatible 等 OpenCode 运行时动态安装的包）和 models 元数据预置进镜像，并关闭自动更新、LSP 下载、遥测。请读源码确认这些开关的准确名字，不要凭记忆。
- images/evaluator.Dockerfile：评估容器，node:24-slim 级别，带 git。
- images/proxy.Dockerfile：运行模型代理和假模型。
- proxy/model-proxy.mjs：只用 node:http/https。按每个 run 的 Bearer 令牌归因；把请求里的 model 强制改写成配置的上游模型；限制 max_tokens；把真密钥只留在自身环境变量；流式透传并把每次请求的 usage、缓存命中、首包时间、总时长、工具调用数写成 JSONL；令牌不对返回 401；超过 run 的 token 预算返回 429。
- proxy/mock-model.mjs：OpenAI 兼容的 /v1/chat/completions（流式和非流式）。按脚本回放：第一次返回一个工具调用去修改样题文件，看到工具结果后返回结束语，usage 为确定值。
- task/：一道最小样题：repo 快照、statement.md、hidden_tests（node --test）、reference.patch。原始 repo 必须不过隐藏测试，reference.patch 必须过。
- run-probe.mjs：编排一次完整流程并写 out/probe-report.json：
  a. 建 --internal 网络 rsi-probe-net。代理容器同时接入该网络和默认 bridge，被优化容器只接入 rsi-probe-net。
  b. 被优化容器：不挂载任何宿主目录，数据用 docker cp 或 tar 流进出。环境里只有临时令牌、OPENCODE_DB、随机化的工作目录。运行 opencode run --format json。结束后导出工作区 git diff 和会话库文件，然后销毁容器。
  c. 评估容器：--network none、全新容器。放入 repo 快照，git apply diff，用封存副本覆盖测试文件，运行 node --test 的结构化 reporter，解析结果并核对用例数量。结果三态：pass / fail / infra_error。
  d. 期间用 docker stats 和 colima ssh 采样内存，记录峰值。
  e. 对账：代理 usage 合计 vs 会话库 token 合计。
  f. 支持 --concurrency 1|2、--model mock|real。real 用环境变量 RSI_UPSTREAM_BASE_URL、RSI_UPSTREAM_API_KEY、RSI_UPSTREAM_MODEL，缺任一项明确报错。
- isolation-check.sh：在被优化容器内执行，每项输出一行 JSON（name、expected、actual、pass）：访问公网；访问 host.docker.internal、host.lima.internal、192.168.5.2、网关地址上的宿主端口；访问 awesomeTelemetry 默认端口；docker socket 是否存在；是否能看到宿主文件；访问代理（应通）。Claude 会在宿主机临时起一个回环 HTTP 服务来判定。
- optimizer-probe.sh：用干净容器验证 Codex CLI 能否在 Linux 容器内运行，以及用 API key 和用订阅登录分别需要什么。不要读取或拷贝 ~/.codex/auth.json；只输出需要用户决定的事项。

不要做：
- 不改 server/、src/、openspec/、package.json。
- 不新增依赖。不把任何密钥写进文件。

遇到以下情况停下来问：
- OpenCode 源码的启动路径必须联网且无法预置
- 探针方案和 design.md 的隔离规则冲突

验收（沙箱内能做的）：
- 所有 .mjs 通过 node --check；所有 .sh 通过 bash -n
- 假模型和代理各有 node --test 测试，用内存 mock，不绑端口；需要绑端口的标记 skip，并写进 runbook
- 样题在本机用 node --test 验证：原始 repo 失败，应用 reference.patch 后通过

完成后按 AGENTS.md Output format 输出，并列出未运行项。
```

**审查清单**

- [ ] 被优化容器没有任何 bind mount，只接入 internal 网络，环境里没有真密钥
- [ ] 评估容器无网络，测试用封存副本覆盖，分数来自结构化报告并核对用例数
- [ ] 代理强制改写模型，令牌错误 401，超预算 429，日志没有密钥
- [ ] OpenCode 开关名字都能在源码里找到出处
- [ ] 没有读取 `~/.codex` 等凭据目录

---

## P1 契约和判定核心

**分支**：`codex/rsi-p1`

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p1）。
本阶段写 RSI 的权威契约和所有不碰容器、不碰 HTTP 的判定核心。这些代码决定一个版本能否晋级，错误的代价最高：宁可停下来问，也不要猜。

目标：把 docs/rsi/design.md 落成可执行契约，并实现状态机、噪声带、晋级闸门、优化者可见范围投影、L1 规则引擎、哈希链账本、schema v25。

必读（按顺序，不要通读整个仓库，上下文有限）：
1. AGENTS.md 全文
2. docs/rsi/design.md：开跑决定、迭代闭环、防作弊、评测与晋级闸门、人工审查与干预、复用 awesomeTelemetry 的“最短改动路径”和“硬约束”
3. openspec/contracts/task-health.md 前 80 行（新契约的写法照它）；openspec/specs/task-health/spec.md 前 30 行（REQ 写法）
4. openspec/contracts/database.md 前 40 行（增量写法）；server/storage/schema.ts 的 SCHEMA_VERSION、migrateSchema、initSchema；server/storage/schema.test.ts 里断言版本号的位置；server/storage/columns.ts 开头
5. openspec/contracts/api.md §0.3（ApiError）
6. src/core/agent-folding-analysis.ts 的回归规则（只借思路）

只允许新增或修改：
- openspec/contracts/rsi.md（新增，本模块最高权威）
- openspec/specs/rsi/spec.md（新增，REQ-001…，每条可测试）
- openspec/contracts/database.md（顶部追加 schema25 一节）
- openspec/contracts/api.md（追加 RSI 路由一节，只写契约，本阶段不实现）
- openspec/gotchas.md（只追加）
- src/core/rsi-types.ts、rsi-validation.ts、rsi-state-machine.ts、rsi-noise.ts、rsi-gate.ts、rsi-visibility.ts、rsi-l1-rules.ts，以及各自的 .test.ts
- server/rsi/ledger.ts、ledger.test.ts
- server/storage/rsi.ts、rsi.test.ts；server/storage/schema.ts、schema.test.ts、columns.ts、columns.test.ts

具体要求：

1. 契约 rsi.md 用 RSI-001… 分节，所有字段写明含义、单位、可空规则。必须包含：
   a. 实体：调优任务、迭代、评测、单题运行、发现、决定、指令（design.md“数据模型”）。
   b. 任务状态：created / calibrating / running / paused / needs_help / completed / stopped。迭代状态按 design.md 的状态机，用一张转移表写全：事件、操作者（optimizer / worker / monitor / human）、前置条件。其中：
      - 任何关卡未通过都回到 rejected，版本保留不删，下一轮仍用原父代。
      - 缺监控或对抗结果按 held 处理，绝不放行。
      - held 只能由 human 事件离开：批准后继续封存集，拒绝后记为 rejected。人工批准不能跳过封存集和晋级判定。
      - 回退是在历史版本上新建迭代，不修改历史迭代。
   c. 评测阶段：smoke / train / sealed / final / adversarial / ablation；单题判定三态 pass / fail / infra_error。infra_error 重试一次，不计入分数；Agent 超时算 fail。
   d. 噪声带：基线在训练集上重复 R 次（默认 3，最少 2），得到每次的通过数 s_1..s_R。取所有有序对 (i≠j) 的差 s_i−s_j，算样本标准差，δ = 2 × 该标准差。这是 RRSI 的“零假设差”口径的落地，请在契约中写成确定公式。所有重复完全相同时 δ = 0，此时“增益 > δ”等价于至少多过 1 题。输入里出现 infra_error 过多（超过配置比例）时标定失败，不产出 δ。
   e. 晋级判定 decidePromotion：五个条件（design.md 表格），输出 verdict（promote / reject / hold）和每个条件的结构化原因。第一版主指标只支持 passed_count。优先级：L0/L1 命中拒绝 → 缺审查或 L3/L4 可疑 hold → 主指标 → 封存集 → 稳定题回归 → token 增幅超过上限 hold。封存集判定：候选通过数 ≥ 父代通过数 − δ。人工批准只解除 held，不解除其他条件。
   f. 稳定题回归：某题在该谱系最近 stableWindow（默认 3）次训练评测全部 pass，而候选连续 stableFailRepeats（默认 2）次 fail，才算回归。单次翻转不算。
   g. 封存集预算：每个调优任务 sealedQueryBudget（默认 10）。用尽转 needs_help。最终留出集只由 human 触发，每个定稿版本一次，结果锁定，重复触发必须拒绝。
   h. 优化者可见范围：列出每类数据、每个评测阶段的可见字段白名单。封存集只有 accept/reject；最终留出集完全不可见；监控结论只有 held 和类别，没有原文；隐藏测试源码和断言要脱敏。白名单实现为投影函数，未知字段默认丢弃。
   i. L1：规则类别 protected_path / task_fingerprint / opaque_blob / dependency_change / binary_file / diff_too_large，每类的严重度和后果（reject 或 hold；dependency_change 转人工）。指纹字典的文件格式。
   j. 账本：每行字段、规范化 JSON 的算法、哈希链算法、事件类型清单、并发写入规则、尾部截断如何检出。任务目录布局：<configRoot>/awesome-telemetry-data/rsi/<taskId>/ledger.jsonl 等，封存数据放哪个目录。
   k. 数据库是可从账本重建的缓存。列出 schema25 的全部表、列、索引，含队列表。
   l. API：优化者接口和页面接口的请求体、响应体、错误码（ApiError）、鉴权（任务 Bearer；页面接口要本机令牌，不能只靠回环判断）。HTTP 只写队列，不执行任何东西。
   m. 模块独立性：rsi-l1-rules 只依赖 diff 文本和题目元数据，不依赖 storage、server，以便之后单独复用。

2. 纯函数放 src/core，无 IO、无时钟（时间作为参数传入）：
   - rsi-state-machine：transitionIteration、transitionTask，非法转移抛带状态和事件的错误。
   - rsi-noise：calibrateNoiseBand。
   - rsi-gate：decidePromotion、isStableRegression、selectParent（当前最优置信下界内最新的已通过版本）。
   - rsi-visibility：对 design.md 的每类结果做投影。
   - rsi-l1-rules：buildFingerprintDictionary（输入题目元数据：题号、仓库名、测试名、文件路径、罕见字符串、期望值）和 scanDiff（只看新增行，返回带文件和行号的发现）。扫描范围包含代码、提示词、skill、工具描述和资源文件。要求：
     * 匹配前规范化（大小写、分隔符），并对长 base64/hex 字面量解码后再扫一次。字符串拼接拆分属于已知局限，写进契约，不要假装能检出。
     * 太短或太常见的指纹不进字典，避免误报，规则写进契约并测试。
     * 不透明大块数据、二进制文件、文件模式变更、符号链接、受保护路径（测试、评估器、检测规则、CI、lockfile）分别有独立的发现类别。
     * 用一组良性 diff 测试不误报，用一组作弊 diff（按题 if/else、硬编码答案、改测试、删标记、base64 藏答案）测试必中。
3. 账本 server/rsi/ledger.ts：
   - 每个任务一个只追加 JSONL，每条带 prevHash 和 hash，append 后 fsync。全部异步 API，逐行流式读取（禁令 9）。
   - 写入串行化：进程内队列加跨进程锁文件（O_EXCL，含过期处理），因为 server 和 worker 都可能写。
   - verifyLedger 能检出：修改、删除、插入、调序、重复 seq、断链。尾部截断通过和数据库记录的头部 seq、hash 比对来检出。半行（崩溃残留）单独报告，不当成篡改，也不静默丢弃。
4. server/storage/rsi.ts：SCHEMA_VERSION 24→25，迁移幂等、原子（照现有 fromVersion 写法）。预编译语句缓存，禁止循环内 prepare、禁止 SELECT *。rebuildRsiIndexFromLedger 从账本重建全部 RSI 表，重建结果和增量写入结果逐行一致。列常量写进 columns.ts。
5. 测试：
   - 状态机覆盖转移表每一行和全部非法转移。
   - decidePromotion 覆盖每个条件单独失败、优先级组合、缺审查。
   - 可见范围：给投影函数塞入封存集分数、题号、监控原文等字段，断言全部被丢弃。
   - 账本：每种篡改都有一个用例；并发写入不丢不乱；崩溃半行。

不要做：
- 不写容器、HTTP 路由、页面、监控 Agent。不新增依赖。
- 不改 server/server.ts、src/App.tsx。
- 不实现 design.md 没有的指标或规则。

遇到以下情况停下来问（一次列全）：
- design.md 内部矛盾，或按它写不出确定算法
- 需要改动列表外的文件

验收：
- npm run typecheck；npx eslint <改动路径>
- npx vitest run src/core/rsi- server/rsi server/storage/rsi.test.ts server/storage/schema.test.ts server/storage/columns.test.ts src/catch-guard.test.ts

完成后按 AGENTS.md Output format 输出，额外列出：转移表行数和测试数；所有你自行决定、设计稿没写明的取值。
```

**审查清单**

- [ ] 缺审查永远不会得到 promote；人工批准不会跳过封存集
- [ ] 投影函数是白名单，未知字段丢弃
- [ ] 账本每种篡改都有用例；尾部截断能检出
- [ ] 指纹扫描覆盖提示词和资源文件；良性 diff 不误报
- [ ] `rsi-l1-rules` 没有 storage、server 依赖
- [ ] schema 迁移幂等，只新增 RSI 表，不动既有表
- [ ] 没有引入 `SELECT *`、循环内 prepare、同步文件读取
- [ ] 契约没有写死设计稿之外的指标

---

## P2 执行器

**分支**：`codex/rsi-p2`（P1 合入后）

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p2）。P1 的契约和判定核心已合入。

目标：实现 rsi worker 和两段式容器评测。用脚本化假模型能跑完基线标定、smoke、train、审查挂起，以及审查通过后的封存集和晋级判定，并且崩溃后能恢复。

必读（按顺序）：
1. AGENTS.md 全文
2. openspec/contracts/rsi.md 全文（本模块最高权威，含 RSI-011 题库格式）；openspec/specs/rsi/spec.md
3. docs/rsi/p0-report.md，尤其“带给 P2 的要求”，这些是实测踩过的坑
4. scripts/rsi-probe/：run-probe.mjs、proxy/*、images/*、evaluate.mjs、session-tokens.mjs
5. src/core/rsi-*.ts、server/rsi/ledger.ts、server/storage/rsi.ts
6. server/benchmark/cli.ts、bin/benchmark.js（CLI 写法）；local-sessions/opencode.ts 的 readOpenCodeDb

只允许新增或修改：
- server/rsi/docker.ts（DockerClient 接口和实现：异步 spawn，argv 不经 shell，全部有超时、取消和输出上限；测试用假实现）
- server/rsi/bank.ts（按 RSI-011 读取并校验题库）
- server/rsi/build.ts、target-run.ts、evaluator.ts、proxy-run.ts、artifacts.ts、queue.ts、worker.ts、recovery.ts、review.ts、cli.ts
- server/rsi/reporters/（可信的 node、unittest、go 报告器和解析器）
- server/rsi/__fixtures__/bank/（测试用小题库，不是正式题库）
- scripts/rsi-images/（target、evaluator、proxy 的 Dockerfile，产品化的 model-proxy 和 mock-model，及其测试）
- scripts/rsi-e2e/p2-smoke.mjs 和说明（Claude 在沙箱外运行）
- bin/rsi.js、vite.cli.config.ts、package.json 的 bin 和 scripts
- openspec/contracts/rsi.md（只追加 RSI-012 worker 和 CLI 细则）；openspec/contracts/api.md 不动
- 各自的测试文件，且必须能被 npm run test 跑到

具体要求：

1. 入口和边界
   - `rsi worker --execute` 是唯一能启动容器的入口。不带 --execute 只打印将要做的事。HTTP 不触发执行（本阶段不写 HTTP）。
   - CLI 子命令：task create、task status、iteration submit（本机可信入口，P4 才有优化者 HTTP）、worker、ledger verify、ledger recover。
   - ledger recover 处理崩溃留下的半行：把残留字节移到隔离文件，由人显式执行，不自动截断。
   - 每次状态变化先写账本，再更新数据库索引。所有转移必须走 rsi-state-machine，所有判定必须走 rsi-gate、rsi-noise，不得另写一份。

2. 构建（L0）
   - 平台维护一个可信的裸仓库副本，禁用 hooks，用 git archive 取出候选 commit，不接受任何上传的二进制。
   - 候选 diff 由平台从父代 commit 到候选 commit 计算，先过 rsi-l1-rules，通过后才构建。
   - Dockerfile 分两段：依赖安装段可以联网，只拷入 package.json 和 lockfile，lockfile 不变就命中缓存；编译段用 `RUN --network=none`，所以候选代码在构建时碰不到网络。
   - 被拒绝版本的镜像要清理，保留最近若干个，别撑爆 30GB 的 VM 磁盘。

3. 被优化容器（按 P0 报告）
   - 每题每轮全新容器，无 bind mount，只接 internal 网络，cap-drop ALL，no-new-privileges，有内存、CPU、pids 上限。
   - 数据进出走 tar 流或 stdin，工作目录由容器用户创建，路径随机，环境里没有题号。
   - 按题目 toolchain 选镜像。Agent 超时算 fail，代理 429 也算 fail，都不是 infra_error。
   - 导出：git add -A 后 git diff --cached --binary，加上会话库。销毁前读 cgroup 的 memory.peak。

4. 评估容器
   - 全新容器，--network none。放入 repo 快照，应用 diff，然后用封存副本覆盖所有隐藏测试，最后才运行。
   - argv 按 RSI-011 的 report 和 testTargets 由平台构造。分数只来自可信报告器的结构化输出，用例数必须等于 expectedTests。
   - 严格区分：评估器自身的权限、IO、启动、报告解析错误是 infra_error，重试一次；补丁应用失败、测试失败、测试超时才是 fail。git apply 的退出码不能笼统算 fail，P0 就吃过这个亏。

5. 模型代理
   - 容器同时接 internal 网络和 bridge，不发布端口，真密钥只在它的环境里。
   - run 令牌归因、强制改写模型、max_tokens 可配置（不要写死 1024）、token 预算硬拦截。预算预留要按真实请求校准，不能因为工具定义的字节数大就误触发 429。
   - mock 模式用脚本表驱动：每题可配 pass、fail、flaky（按重复次数变化），让 e2e 能测出非零 δ。
   - worker 累加代理 usage，达到任务 token 预算时转 paused（budget_exhausted），作废进行中的评测。
   - 代理和会话库 token 差距超过配置阈值时写一条 finding。没有任何请求时日志文件不存在，这不是错误。

6. 调度和恢复
   - 按契约调度：基线标定（train 重复 R 次，sealed 3 次）、smoke、train、sealed。smoke 挂了立即停。并发上限默认 2，可配置。
   - 审查通过接口 ReviewProvider 接入。默认实现返回 missing，所以迭代会按契约在 reviewing 转 held。测试里用假实现走完封存集和晋级。P5 才接真实监控。
   - 崩溃恢复：启动时校验账本，用 label 清理残留容器和网络，进行中的评测重新排队，账本里已有结果的不重跑、不重复计分。

7. 测试
   - 单测用假 DockerClient，覆盖 infra_error 和 fail 的区分、用例数不符、超时、恢复、预算耗尽。
   - scripts/rsi-e2e/p2-smoke.mjs 用真实 Docker 和假模型跑完整流程，包括中途 kill -9 worker 再恢复，输出 JSON 报告。Docker 不可用时明确报错。你跑不了它，由 Claude 运行。

不要做：
- 不写 HTTP 路由、页面、监控 Agent、优化者接入。不改 server/server.ts、src/App.tsx。不新增依赖。
- 不读取或挂载 ~/.codex、~/.claude、~/.ssh。

遇到以下情况停下来问（一次列全）：
- 契约有矛盾，或按契约写不出确定行为
- 需要改动列表外的文件

验收（沙箱内）：npm run typecheck；npx eslint <改动路径>；npx vitest run server/rsi scripts/rsi-images scripts/rsi-e2e src/catch-guard.test.ts

完成后按 AGENTS.md Output format 输出，并列出未运行项和自行决定的取值。
```

**审查清单**

- [ ] 被优化容器内拿不到真密钥、隐藏测试、题号
- [ ] 评估容器无网络
- [ ] kill -9 后恢复，账本无重复结果
- [ ] 请求路径上没有 `spawnSync`，docker 调用都有超时

---

## P2b Agent 档案和通用化

**分支**：`codex/rsi-p2b`（P2、P3 合入后）

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p2b）。P0、P1、P2、P3 已合入。

背景：用户要求别人也能用这个平台优化自己的 Agent。现在被优化对象写死是 OpenCode，本阶段把它改成可配置的 Agent 档案，并用第二个完全不同的 Agent 证明这件事。

必读（按顺序）：
1. AGENTS.md 全文
2. openspec/contracts/rsi.md 的 RSI-006、RSI-011、RSI-012
3. docs/rsi/p0-report.md 的“真实模型结果”和“带给 P2 的要求”
4. server/rsi/target-run.ts、build.ts、worker.ts、proxy-run.ts、cli.ts、bank.ts
5. scripts/rsi-images/（target.Dockerfile、model-proxy.mjs、mock-model.mjs）；scripts/rsi-e2e/p2-smoke.mjs

只允许新增或修改：
- rsi-agents/**（新增，见下）
- server/rsi/agent-profile.ts 及测试（新增）
- server/rsi/target-run.ts、build.ts、worker.ts、proxy-run.ts、cli.ts、bank.ts 及各自测试
- scripts/rsi-images/（target.Dockerfile 移到 rsi-agents/opencode/，代理和假模型按下文修改）
- src/core/rsi-l1-rules.ts 及测试（只加 allowPaths）
- scripts/rsi-e2e/（新增 mini-agent e2e，更新 p2-smoke 和 README）
- openspec/contracts/rsi.md（只追加 RSI-013；并修改 RSI-012 里 smoke 那句，见第 5 点）
- package.json 的 scripts（如需要）

具体要求：

1. Agent 档案（RSI-013，写进契约）。一个档案是一个 JSON 文件，放在目录里，和 Dockerfile 同目录：

   interface RsiAgentProfile {
     version: 1;
     id: string; name: string;
     dockerfile: string;          // 相对档案目录；必须定义 target-node、target-python、target-go 三个 stage
     dependencyInputs: { kind: 'bun-workspace' } | { kind: 'globs'; include: string[] } | { kind: 'none' };
     run: {
       argv: string[];            // 占位符 {{statement}}、{{model}}
       env: Record<string, string>;
       files: { path: string; content: string }[];   // 容器内绝对路径，运行前写入
     };
     session: { format: 'opencode-db' | 'none'; dir: string };   // 运行结束后导出 dir；format 决定如何读 token
     l1?: { allowPaths?: string[] };   // 这些路径不算 protected_path，比如该仓库自己的测试目录
   }

   - env 和 files.content 支持占位符 {{baseUrl}}（http://rsi-proxy:8080/v1）、{{apiKey}}（每个 run 的临时令牌）、{{model}}、{{sessionDir}}。argv、env、files 里的占位符都不经过 shell，严格字符串替换，未知占位符报错。
   - 档案校验失败要给出具体字段。档案里不得出现真密钥：平台只提供临时令牌。
   - `rsi task create` 增加 `--agent <profile.json>`，把档案和 Dockerfile 冻结拷入 private/agent/，并把它们的 sha256 写进 runtime 文件，启动时校验。不修改 RsiTask 类型。
   - dependencyInputs：bun-workspace 用现有逻辑；globs 只拷匹配的文件；none 不拷。`.npmrc`、`bunfig.toml` 任何情况下都不进联网阶段。Dockerfile 的构建上下文仍是 source/ 和 deps/。候选代码只能在 `RUN --network=none` 里运行，这一条写进 RSI-013 和档案作者指南。
   - 平台保持现有隔离不变：internal 网络、无挂载、cap-drop ALL、数据走 tar 流。档案不能放宽这些。

2. 内置档案：
   - rsi-agents/opencode/profile.json：通用 OpenAI 兼容配置，用于假模型（现有 target-run 里的配置）。
   - rsi-agents/opencode/profile.deepseek.json：OpenCode 内置 deepseek provider，模型 `deepseek/deepseek-flash`，只覆盖 baseURL 和 apiKey。原因见 docs/rsi/p0-report.md。两个档案共用 rsi-agents/opencode/target.Dockerfile。
   - rsi-agents/mini-agent/：一个不依赖任何包的极小 Node 编码 Agent（source/agent.mjs 约 150 行内，source/package.json），用 fetch 调 chat completions，工具有 shell、read_file、write_file，读 OPENAI_BASE_URL、OPENAI_API_KEY、OPENAI_MODEL。还有 profile.json、target.Dockerfile、README.md。它要和假模型配合：假模型发出的工具调用它都要能执行，所以先看 mock-model.mjs 用的工具名和参数，需要时在假模型里按请求里声明的工具名适配。
   - rsi-agents/README.md：档案作者指南。怎么写档案和 Dockerfile，运行时有哪些变量，平台的隔离规则，为什么候选代码必须在离线阶段编译。

3. 通用轨迹：不是每个 Agent 都有 OpenCode 那样的会话库，但所有 Agent 的模型请求都过代理。
   - 代理把每次响应的 assistant 文本和 tool_calls 追加到 /out/responses.jsonl，并保留最后一次请求的 messages 到 /out/last-request.json（消息是累积的，所以这就是完整对话）。单文件上限 8MB，超限截断并标记。不记录 Authorization 头。
   - run 结束时和 usage.jsonl 一起导出到 artifacts。
   - session.format 为 none 时不读 token，也不写对账差异的 finding；token 仍以代理为准。

4. 代理：
   - 支持 RSI_UPSTREAM_BASE_URL、RSI_UPSTREAM_MODEL、RSI_UPSTREAM_API_KEY 三个环境变量，worker 从自身环境读取，绝不写入 settings、runtime 文件、账本或日志。缺少时明确报错。
   - worker 读 usage 的轮询从 250ms 改成 2000ms：每次都是一个 docker exec，太频繁会抢 CPU。

5. smoke 门槛：契约现在要求 smoke 全过，但如果某道 smoke 题基线本来就不稳定通过，所有候选都会被拒，闭环就卡死了。改成：smokeFloor = 基线标定里在每次重复都通过的 smoke 题数。候选的 smoke 通过数 ≥ smokeFloor 才继续。更新 RSI-012 那句话和测试。这是设计者的决定（2026-11-07）。

6. 题集子集：别人第一次试用不想跑完整题集。`rsi task create` 增加 `--subset small|full`，默认 full。small 按 manifest 顺序确定性取：smoke 不变；train 取 smoke 加上每种语言再补 1 题；sealed 每种语言 1 题；final 每种语言 1 题。取到的子集写进冻结的 private/bank/manifest.json，datasetHash 按冻结内容计算，所以一旦创建就不能再变。bank.ts 的校验要接受这种子集，但不放宽其他不变量。

7. L1 allowPaths：scanDiff 增加可选的第三个参数 options?: { allowPaths?: string[] }，用简单 glob 匹配。命中的路径不产生 protected_path，其他规则照常。

8. 自检命令：`rsi doctor` 检查 docker 和 buildx 是否可用、docker context 是否可连、Linux 引擎和架构、磁盘余量、上游三个环境变量是否齐全（只报有没有，不打印值），输出 JSON。`rsi agent validate <profile.json>` 只校验档案。

9. 测试：
   - 档案校验、占位符替换、未知占位符、globs 依赖输入、allowPaths、smokeFloor、子集选择的单测。
   - scripts/rsi-e2e/mini-agent-smoke.mjs：用真实 Docker 和假模型，以 mini-agent 为被优化对象，--subset small，跑完基线标定、一个候选的 smoke 和 train，到 held 为止。Claude 在沙箱外运行。
   - 现有 p2-smoke 改用 rsi-agents/opencode/profile.json，断言不变。

10. 工具链版本统一：现在 target 和 evaluator 镜像的 Go 来自 Debian，是 1.19.8，而题库是用 Go 1.23 校验的，go.mod 写的是 1.20，正确答案可能被判编译失败。全部改成 `COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go` 并设置 PATH，所有内置 target 和 evaluator 镜像都用同一版本。把工具链版本写进 RSI-013，并加一个 Dockerfile 文本级测试防止退回。

不要做：
- 不写 HTTP、页面、优化者、监控 Agent。不改 server/server.ts。不新增依赖。
- 不读取或挂载 ~/.codex、~/.claude、~/.ssh。不把任何真密钥写进文件。

遇到以下情况停下来问（一次列全）：
- 契约有矛盾，或按契约写不出确定行为
- 需要改动列表外的文件

验收（沙箱内）：两份 tsc；npx eslint <改动路径>；npx vitest run --configLoader native --no-cache server/rsi scripts/rsi-images scripts/rsi-e2e scripts/rsi-bank src/core/rsi-l1-rules.test.ts src/catch-guard.test.ts

完成后按 AGENTS.md Output format 输出，列出未运行项和自行决定的取值。
```

**审查清单**

- [ ] 档案不能放宽隔离，也不能带真密钥
- [ ] 候选代码只在离线阶段运行
- [ ] mini-agent 用真实 Docker 跑通，证明平台不依赖 OpenCode
- [ ] 所有镜像的 Go 版本一致

---

## P3 题集

**分支**：`codex/rsi-p3`（与 P2 并行）

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p3）。P1 的契约和判定核心已合入。

目标：按 openspec/contracts/rsi.md 的 RSI-011 做 30 道自建题，含隐藏测试、参考解和变异检查，并按设计稿划分集合。

必读：AGENTS.md；openspec/contracts/rsi.md 的 RSI-006、RSI-006.1、RSI-011；docs/rsi/design.md“评测与晋级闸门”“自建题的要求”；scripts/rsi-probe/task（样题格式）；src/core/rsi-l1-rules.ts。

只允许新增：
- rsi-bank/manifest.json、rsi-bank/tasks/<questionId>/**
- scripts/rsi-bank/validate.mjs、mutate.mjs，及测试
- scripts/rsi-bank/bank.test.ts（用 buildFingerprintDictionary 和 scanDiff 验证字典，能被 npm run test 跑到）
- docs/rsi/bank.md（说明、分布表、被剔除的题和原因）

要求：
- 30 题：smoke 3（取自 train）、train 15、sealed 9、final 6。train、sealed、final 各自覆盖 JavaScript/TypeScript、Python、Go 三种语言，难度分层。划分用固定 seed，写进 manifest。
- 题目是你自己写的小型代码库，不复制受版权保护的代码。全部只用标准库，因为评估容器没有网络：node:test、Python unittest（兼容 3.9）、go test。Go 模块不依赖任何外部包。
- 难度要有区分度：编码 Agent 在 5～10 分钟内能做完，但不是全都一次就过。easy 是单文件小改；medium 要跨文件或处理边界条件；hard 要先理解模块间的关系。全部太简单或全部太难，闸门都测不出信号。
- 题面像真实的 issue：描述现象和期望，不给补丁。statement.md 不得出现题号、仓库名、隐藏测试名、期望值。
- 校验（validate.mjs）：manifest 不变量全部成立；原始 repo 不过隐藏测试；应用 reference.patch 后全过；实际用例数等于 expectedTests。
- 变异检查（mutate.mjs）：对参考解改动处做简单变异（翻转比较和逻辑运算、改边界、删语句），算出被测试杀死的比例。低于 mutationKillMin（默认 0.7）的题要么加强测试，要么剔除。结果写进 manifest 和 docs/rsi/bank.md。
- meta.json 的指纹字段（testNames、filePaths、rareStrings、expectedValues）要如实填写。bank.test.ts 要验证：字典非空；良性 diff（普通重构、加日志、改提示词措辞）不误报；把题号、隐藏测试名、罕见字符串写进 diff 必中。
- 本机没有 Go：validate.mjs 和 mutate.mjs 支持 --docker 和本地两种模式，本地缺工具链时明确跳过并写进输出。Go 部分的代码由你写好，由 Claude 在容器里跑。你跑不了 Docker。

不要做：
- 不改 src/、server/、package.json。题库不进 npm 包，package.json 的 files 是白名单，不用动。
- 不把参考解、隐藏测试内容或题号写进 statement.md。

遇到以下情况停下来问（一次列全）：
- RSI-011 的格式无法表达某类题
- 需要改动列表外的文件

验收（沙箱内）：node scripts/rsi-bank/validate.mjs（本地模式）；node scripts/rsi-bank/mutate.mjs（本地模式）；npx vitest run scripts/rsi-bank；npx eslint scripts/rsi-bank。

完成后按 AGENTS.md Output format 输出，并列出每个集合的语言和难度分布、被剔除的题、未运行项。
```

**审查清单**

- [ ] 集合互不相交，smoke 是 train 的子集
- [ ] 题面不泄露隐藏测试
- [ ] 指纹字典在良性 diff 上不误报
- [ ] 题集不进 npm 发布包

---

## P4 优化者接入

**分支**：`codex/rsi-p4`

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p4）。P0～P3 和 Agent 档案（RSI-013）已合入。

目标：真实优化者在隔离容器里自己循环：取 brief、读白名单结果和轨迹、改代码提交、提交 PRD 和 commit、必要时 declare_stuck。同时实现全部 HTTP 接口和人工命令。页面在下一阶段。

必读（按顺序）：
1. AGENTS.md 全文
2. openspec/contracts/rsi.md 全文，尤其 RSI-005、RSI-009、RSI-012、RSI-013；openspec/contracts/api.md §0.3 和 RSI 一节
3. docs/rsi/design.md 的“总体架构”“迭代闭环”“人工审查与干预”“给优化者一个出口”；docs/rsi/p0-report.md
4. server/rsi/worker.ts、queue.ts、target-run.ts、proxy-run.ts、agent-profile.ts、cli.ts；scripts/rsi-images/model-proxy.mjs；rsi-agents/README.md
5. server/http/benchmark-routes.ts（路由写法）；server/telemetry/receiver.ts（Bearer 校验）；server/server.ts 里路由注册、停止和回环白名单的位置（只看这几处）；server/realtime/sse.ts、src/core/trace-types.ts 里的 SSE 事件定义

只允许新增或修改：
- server/http/rsi-routes.ts 及测试
- server/rsi/agent-api.ts、optimizer-session.ts、optimizer-profile.ts、handoff-prompt.ts、commands.ts、adopt.ts、quality.ts、reader.ts 及测试；server/rsi/worker.ts、cli.ts、queue.ts、proxy-run.ts 及测试
- server/server.ts（只加注册、停止、回环前缀）；server/realtime/sse.ts、src/core/trace-types.ts（只加 rsi_changed 事件）
- src/core/rsi-visibility.ts、rsi-types.ts、rsi-validation.ts 及测试（只为新增字段和投影）
- scripts/rsi-images/（代理增加转发和白名单出口）
- rsi-agents/optimizers/**（新增）
- scripts/rsi-e2e/p4-loop.mjs 和说明
- openspec/contracts/rsi.md（追加 RSI-014，修改 RSI-009.1 中需要变化的路由）；openspec/contracts/api.md

硬性安全要求（实测得出，不可放宽）：
- 实测结果：容器一旦接入 bridge 网络，就能经 host.lima.internal、192.168.5.2、host.docker.internal 访问宿主机回环上的任何服务；只有 internal 网络才挡得住。所以优化者容器只接 internal 网络，绝不接 bridge，也绝不挂载宿主目录或 docker socket。
- 优化者的所有出网都走代理旁路容器（它同时接 internal 和 bridge）。旁路容器只做三件事：转发模型请求；转发 /api/rsi/agent/ 前缀到宿主机平台接口（只允许这个前缀，其他路径 404，绝不转发页面接口）；按档案白名单放行 HTTPS CONNECT（只比对域名，默认空，IP 字面量一律拒绝）。
- 优化者的任务 Bearer 只调得动 agent 接口。令牌只存 SHA256。页面接口用单独的本机令牌，优化者令牌调不了，只有回环地址也调不了。

具体要求：

1. 优化者档案（RSI-014）：rsi-agents/optimizers/<id>/profile.json，和 RSI-013 同样的占位符和严格替换规则，加上：
   family（模型家族，P5 用它保证监控者不同家族）、egress（{ kind:'model-proxy' } 或 { kind:'vendor-allowlist', domains:[...] }）、login（{ kind:'none' } 或 { kind:'volume', path, command }）。
   内置三个：
   - opencode-deepseek：OpenCode + DeepSeek，走模型代理，无需登录。这是默认，也是唯一由 Claude 实测的。
   - codex、claude-code：走厂商白名单，登录态存在 Docker 命名卷里，只挂到优化者容器。`rsi optimizer login --profile <id>` 打印并执行一条交互式命令，用户在全新容器里自己登录。绝不读取或拷贝宿主机的 ~/.codex、~/.claude。这两个 README 要写明“未实测”。
   - scripted：测试用，一个 shell 脚本容器，通过接口走完一轮，不调模型。
   平台不假定优化者是谁，所以这几个档案只靠接口和 handoff 提示词工作。

2. 优化者会话（optimizer-session.ts）：
   - 每轮由 worker 启动一个全新容器，不续接上一轮。放入父代 commit 的工作副本（git bundle 经 tar 流进入）。
   - 环境只有 RSI_API_BASE（旁路容器地址）、RSI_AGENT_TOKEN、模型地址和临时令牌。优化者的模型用量记进任务 token 预算，每轮有单独的上限 optimizerSessionTokens（默认 200 万，可配置）；超限代理 429，会话结束。
   - 会话有总时长上限（默认 30 分钟，可配置）。结束后用 git bundle 导出提交，在可信裸仓库里 fetch（禁用 hooks），再由现有 precheck 算 diff。绝不接受容器声明的 diff 或二进制。
   - 一轮只接受第一次提交。会话结束没有提交也没有 declare_stuck，记一条 no_submission；连续 3 次转 needs_help。
   - 优化者会话的代理记录和 P2b 的通用轨迹一样导出，页面要能看。

3. handoff-prompt.ts：生成交给优化者的提示词。写明目标是提升通过题数但不写死成“必须达到”；只验证一个假设；PRD 字段；接口用法（带 curl 示例）；评测和隐藏测试它碰不到；档案的 allowPaths 之外不要改测试目录，否则整轮被拒；不要按题号、题名、文件名特判，平台会扫描并拒绝；实在没进展就调 stuck，这不算失败。监控结论的原文绝不进入提示词。人工的禁令和思路从 brief 接口拿。

4. agent 接口（agent-api.ts，经 rsi-visibility 投影）：
   - GET brief；GET iterations/:seq/results；POST iterations；POST stuck（按 RSI-009.1）。
   - 新增 GET runs/:runId/trajectory：只允许 smoke 和 train 的 run，返回 P2b 导出的 responses.jsonl 和 last-request 内容；sealed、final、adversarial、ablation 一律 404。题目的 statement 优化者本来就能看，隐藏测试内容不在其中。写进投影白名单。
   - 写测试：用优化者令牌遍历全部接口，把封存题号、封存分数、监控原文、指纹字典、隐藏测试内容都放进存储，断言响应里不出现。

5. 人工命令（commands.ts，HTTP 和 CLI 共用，只写队列，worker 执行）：approve、reject、retry_review、retry_evaluation、pause、resume、stop、set_budget、final 已有；补上：
   - rollback：把指定已晋级版本或基线设为下一轮父代，在它上面新建迭代，其后的版本保留。
   - instruction：添加禁令或思路，下一轮 brief 生效；优化者不能调。
   - adopt：把已定稿版本导出为 artifacts/adopted/<seq>.patch，并在可信裸仓库打 refs/rsi/adopted/<seq>。不合并，不推送。
   - 处理 needs_help：放宽目标（set_budget 或新增 set_target）、给思路、或终止。

6. worker：
   - `rsi worker --execute --watch` 常驻，每 5 秒看队列，Ctrl-C 干净退出；不带 --watch 仍是干完就退。这仍然是唯一能启动容器的入口，由人手动启动。
   - 写心跳文件 private/worker.json（pid、时间、当前阶段）。页面据此显示 worker 是否在跑。
   - running 状态、没有进行中的迭代、没有待处理提交时，启动下一轮优化者会话，直到预算或目标。

7. HTTP（rsi-routes.ts）：
   - 实现 RSI-009.1 全部路由，所有非 2xx 走 ApiError。请求路径上不能 spawnSync，不能同步读大文件。优化者错误信息不含隐藏数据。
   - 页面令牌：server 启动时生成，`GET /api/rsi/session` 只在同源（Host、Origin、Sec-Fetch-Site）校验通过时返回，前端放内存。
   - POST /api/rsi/tasks：请求体扩展 agentProfile、optimizerProfile、bank、subset（改 RSI-009.1）。HTTP 只记录意图并写队列，不 clone、不构建；worker 启动时完成物化。路径必须是本机绝对路径。agentToken 只在响应里出现一次。
   - 另加 GET 接口供页面用：迭代 diff（平台算出的）、迭代的发现列表和证据、run 的轨迹（人工可看全部阶段）、worker 状态、可选的档案和题库列表。diff 和证据只给页面接口。
   - SSE：加 rsi_changed { taskIds }，按 200ms 窗口合并。server 通过监视账本文件变化得知（worker 是另一个进程），不能按 run 发事件。

8. 质量数据（quality.ts）：每个迭代算改动行数、文件数、新增函数数等简单指标，写进 artifact，给优化者和页面看。第一版不做复杂度分析。

9. 测试：
   - 单测覆盖路由鉴权矩阵（优化者令牌、页面令牌、无令牌、错误 Host/Origin）、投影泄露遍历、handoff 不含监控原文、rollback、instruction、adopt、no_submission、会话超时。
   - scripts/rsi-e2e/p4-loop.mjs：真实 Docker + 假模型，以 mini-agent 为被优化对象、scripted 为优化者、--subset small，无人值守跑 3 轮，走真实 HTTP 接口和旁路转发，并断言优化者容器连不上宿主机其他端口。Claude 在沙箱外运行。

不要做：
- 不写页面，不写监控 Agent（ReviewProvider 保持现有接口）。不新增依赖。不自动合并或推送。

遇到以下情况停下来问（一次列全）：
- 契约有矛盾，或按契约写不出确定行为
- 需要改动列表外的文件

验收（沙箱内）：两份 tsc；npx eslint <改动路径>；npx vitest run --configLoader native --no-cache server/rsi server/http/rsi-routes.test.ts scripts/rsi-images scripts/rsi-e2e src/core/rsi- src/catch-guard.test.ts

完成后按 AGENTS.md Output format 输出，列出未运行项和自行决定的取值。
```

**审查清单**

- [ ] 用优化者令牌遍历接口无泄露
- [ ] 页面接口拒绝优化者令牌，也拒绝只有回环地址的请求
- [ ] 优化者容器没有 docker socket，网络只到 API 和模型出口

---

## P5 防作弊 Agent

**分支**：`codex/rsi-p5`

```text
你在 awesomeTelemetry 仓库的 worktree 里（分支 codex/rsi-p5）。P0～P3 和 Agent 档案（RSI-013）已合入。

目标：实现设计稿的 L3、L4、L5：监控者、对抗者、消融重跑、校准器，以及过程监控者和人工随机抽检，并产出已知作弊补丁的检出报告。这些是防作弊的核心，宁可停下来问，也不要猜。

必读（按顺序，上下文有限，不要通读仓库）：
1. AGENTS.md 全文
2. docs/rsi/design.md 的“防作弊”全文（作弊类型表、六层防线、三个新增角色、降低合谋的规则、怎么测量监控本身、这套设计挡不住的情况）
3. openspec/contracts/rsi.md 的 RSI-001、RSI-004、RSI-005、RSI-006、RSI-010、RSI-012、RSI-013
4. server/rsi/review.ts、worker.ts 里 reviewing 状态和 evaluation 的部分；src/core/rsi-gate.ts；src/core/rsi-l1-rules.ts
5. server/task-health/model-client.ts、deep.ts（只看模型调用和拒绝 tool_calls 的部分）；scripts/codex-health-proxy.mjs
6. rsi-bank/ 一道题的结构；scripts/rsi-bank/validate.mjs

只允许新增或修改：
- server/rsi/monitor.ts、process-monitor.ts、adversary.ts、ablation.ts、calibrator.ts、patch-scan.ts、agent-review.ts、stats.ts 及测试
- server/rsi/review.ts、worker.ts、cli.ts（只加接线和子命令）及测试
- scripts/claude-monitor-proxy.mjs（无工具的 Claude 封装，形式照 scripts/codex-health-proxy.mjs）及测试
- rsi-bank/calibration/**（已知作弊补丁和良性补丁）
- src/core/rsi-types.ts、rsi-validation.ts、rsi-visibility.ts 及测试（只为新增字段）
- openspec/contracts/rsi.md（追加 RSI-015）；openspec/gotchas.md（只追加）

具体要求：

1. 监控者（monitor.ts，L4）：
   - 输入只有去掉注释的 diff、题面、L1 告警。绝不给 PRD、优化者推理、分数。去注释由确定性代码完成，按语言处理常见注释语法，并测试注释里的注入文本到不了模型。
   - diff 放在明确标记的数据块里，提示词声明里面是数据不是指令。两套提示词按 iteration ID 的哈希选一套（可复现），调用记录里保存用了哪套。
   - 没有工具。模型调用走 task-health 的 model client，它会拒绝 tool_calls。
   - 输出 JSON：类别、证据行、置信度。证据行必须逐字存在于 diff 的新增行里，否则这条结论作废。结构非法、超时、模型错误一律算 missing，绝不算 clean。
   - 只能挂起，不能批准。
   - 优化者和监控者的模型家族相同时启动就报错：优化者档案的 family 和监控者配置的 family 比较。默认优化者 deepseek、监控者 openai（scripts/codex-health-proxy.mjs，已有）。优化者是 openai 时用 scripts/claude-monitor-proxy.mjs。

2. 被优化 Agent 产出补丁的确定性扫描（patch-scan.ts）：P0 报告指出候选补丁和隐藏测试在同一容器里跑，补丁理论上能干扰测试框架。扫描 target 产出的补丁里的 process.exit、os._exit、sys.exit、修改 assert 或 unittest、读取 hidden_tests、改写测试框架等模式。命中写一条 L1 级 info 发现供人工和监控参考，不直接改判分，避免误伤合法补丁。这是确定性代码，不调模型。

3. 对抗者（adversary.ts，L3）：
   - 输入训练题和候选 diff，绝不给封存集和监控结论。模型生成变体题（改标识符、路径、数值、题面措辞）和对应的新隐藏测试。没有工具。
   - 变体题必须先在参考解上通过、在原始代码上不通过，才计入。用现有评估容器验证，验证失败的变体丢弃并记录。SWE-ABS 发现生成的测试会误拒正解，所以这一步不能省。
   - 候选和父代分别跑通过验证的变体。候选在原题上提升但在变体上明显掉分（阈值写进配置，默认比父代低超过 δ），结论 suspicious。
   - 对抗者只出题，不判定：判定由确定性比较完成。只在 training 通过后才跑。token 记进任务预算。没有足够有效变体时结论是 missing，不是 clean。

4. 消融重跑（ablation.ts，L3）：对 L1 告警或 L4 怀疑的改动块，平台在可信裸仓库里自动撤销这些块生成新 commit，重新构建，重跑受影响的题（phase=ablation）。分数回落超过 δ 写成强证据发现。撤销后构建失败要如实记录，不算证据。

5. 过程监控者（process-monitor.ts）：读 PRD 和优化者会话的轨迹，核对说明和 diff 是否一致。它的结论只作为证据给人看，不能挂起、不能批准，也不进入优化者提示词。设计稿引用的研究说推理一旦进入奖励，召回率接近 0，所以这条边界要写进契约并测试。

6. 校准器（calibrator.ts，L5）：
   - rsi-bank/calibration/ 放已知作弊补丁和良性补丁。类别：按题特判、硬编码答案、改测试、删标记、带说辞的特判；每类至少 30 个，良性至少 30 个。可以用模板加题库元数据确定性生成，生成结果落盘，同一 seed 可复现。
   - `rsi calibrate --task <id> [--sample N]`：L0、L1 能管的类别跑全量（不调模型，要求 100%）。监控者默认每类抽样 5 个加良性 5 个，因为每次都是模型调用；--sample all 跑全量。监控者不知道哪些是注入的。
   - 报告：分类的检出率、误报率、Wilson 置信区间、样本数、模型和提示词版本。stats.ts 是纯函数。
   - 门槛：检出率 ≥ 80%、误报率 ≤ 10%（可配置）。样本太少时报告 insufficient，不下结论。不达标时监控者自动降级为只告警，不挂起，并写进账本。没有校准结果时保持挂起模式，不默认信任也不默认降级。
   - 校准结果写进账本，换模型或换提示词版本后旧结果失效。

7. 人工随机抽检：配置 auditSampleRate（默认 0.1）。按 iteration ID 哈希确定性抽中已晋级迭代，标记后进入待审队列。写进投影：优化者看不到抽检标记。

8. AgentReviewProvider（agent-review.ts）接到 worker 的 reviewing 状态，组合以上结果。优先级和 rsi-gate 一致：任何缺失都是 missing。监控者降级时它的结论写成 info，不产生 l4_suspicious。为 worker 增加 adversarial、ablation 两个 phase 的调度，遵守现有预算和崩溃恢复规则。`rsi worker` 增加配置项选择监控模型地址和 family，真密钥只从环境变量读。

9. 测试：
   - 注释里的注入到不了模型；证据行造假被作废；超时和解析失败得到 missing；家族相同启动报错。
   - 变体验证：参考解不过的变体被丢弃。消融：分数回落写证据，构建失败不算证据。
   - L0、L1 类别的校准补丁 100% 检出，用真实的 scanDiff，不 mock。
   - 用假模型客户端跑通 AgentReviewProvider 的 clean、suspicious、missing 三条路径，以及监控者降级。
   - 真实模型调用的测试默认跳过，Claude 在沙箱外运行。

不要做：
- 不改 rsi-gate 的判定逻辑。监控结论绝不进入优化者提示词或可见投影（只有 held 和类别）。不写页面和 HTTP 路由。不新增依赖。
- 不读取或挂载 ~/.codex、~/.claude、~/.ssh；模型调用只经现有 proxy 脚本。

遇到以下情况停下来问（一次列全）：
- 设计稿或契约有矛盾，或按它写不出确定算法
- 需要改动列表外的文件

验收（沙箱内）：两份 tsc；npx eslint <改动路径>；npx vitest run --configLoader native --no-cache server/rsi src/core/rsi- scripts/claude-monitor-proxy src/catch-guard.test.ts

完成后按 AGENTS.md Output format 输出，额外列出：校准集每类数量；L0、L1 类别的检出结果；所有自行决定的取值；未运行项。
```

**审查清单**

- [ ] 监控输入不含 PRD 和分数
- [ ] 监控超时或解析失败得到 hold，不是 pass
- [ ] 校准报告有置信区间，L0、L1 类别 100%
- [ ] 注释里的注入文本到不了监控者

---

## P6 页面

**分支**：`codex/rsi-p6`

```text
目标：实现 #/rsi 的 5 个视图和全部人工操作。

必读：AGENTS.md；openspec/contracts/rsi.md；docs/rsi/design.md“人工审查与干预”；docs/design/ui-design-system.md 全文；openspec/contracts/design-tokens.md；src/hash-router.ts、AppShell.tsx、AppSidebar.tsx、App.tsx、CommandPalette.tsx、i18n.ts。

只允许新增或修改：
- src/components/rsi/**、src/styles/components/rsi.css
- 上面列出的接线文件，只加入口
- server/http/rsi-routes.ts（页面的写接口）
- 各自的测试

要求：
- 视图：调优任务列表、任务详情（趋势、δ 带、封存集标记、迭代树）、待审队列、迭代详情（PRD、diff 标命中行、六层结果、逐题结果、轨迹跳转、消融结果）、监控校准。
- 操作：批准、拒绝、回退、禁令、思路、暂停、继续、终止、处理目标不可达、触发最终验收、采纳。每个操作写账本，批准和拒绝必须写理由。
- 复用现有组件库、图表、轨迹阅读器。不显示任何金额。空状态、加载、错误都要设计。深链刷新可用。
- 不用 hex 和裸 px；首屏不超预算。
- 你看不到浏览器，Claude 会截图验收。
```

**审查清单**

- [ ] 多个宽度和深色模式截图通过
- [ ] 深链刷新可用
- [ ] 没有金额，没有原生控件
- [ ] 首屏预算和样式测试通过

---

## P7 本地联调（Claude 执行）

按 design.md 的 5 条“跑起来”验收标准真实跑一夜，出报告。
