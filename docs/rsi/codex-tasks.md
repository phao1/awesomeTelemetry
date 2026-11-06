# Codex 执行手册：本地 RSI

配套设计：[design.md](design.md)。每一节是一段可以整段交给 Codex 的指令，外加 Claude 审查时逐项核对的清单。P2 起的指令在启动前由 Claude 按 P0 实测和 P1 契约修订，以启动时的版本为准。

## 怎么用

1. 所有阶段基于 `dev1106-rsi`。Claude 为每个阶段建 worktree 和分支（`../rsi-pN`、`codex/rsi-pN`），`node_modules` 软链到主检出。
2. Codex 不提交。Claude 审查、跑沙箱外验证，再提交并合回 `dev1106-rsi`。不推送，不合并 `main`。
3. Codex 回复里出现 “Needs confirmation” 时，Claude 恢复同一会话作答，并要求它一次列出所有阻塞项。
4. 每个阶段都在用户能看到的终端标签里运行，保留日志。

顺序：P0 和 P1 可并行（文件不重叠）→ P2 和 P3 并行 → P4 → P5 → P6 → P7（Claude 联调）。

| 阶段 | 模型 | 强度 |
| --- | --- | --- |
| P0 环境探针脚本 | `gpt-6.1-sol` | `medium` |
| P1 契约和判定核心 | `gpt-6-astra` | `ultra` |
| P2 执行器 | `gpt-6.1-sol` | `high` |
| P3 题集 | `gpt-6.1-sol` | `medium` |
| P4 优化者接入 | `gpt-6.1-sol` | `medium` |
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
目标：实现 rsi worker 和两段式容器评测。

必读：AGENTS.md；openspec/contracts/rsi.md 全文；docs/rsi/p0-report.md（P0 实测结果，优先于设计稿的推测）；scripts/rsi-probe/ 全部；server/benchmark/runner.ts 的驱动协议（只借协议）；server/benchmark/cli.ts 和 bin/benchmark.js（CLI 写法）；local-sessions/opencode.ts 的 readOpenCodeDb。

只允许新增或修改：
- server/rsi/docker.ts（异步调用 docker CLI，全部有超时和取消）
- server/rsi/build.ts（干净容器里按 commit 构建被优化 Agent，不接受任何上传的二进制）
- server/rsi/target-run.ts（被优化容器，只导出 diff 和会话库）
- server/rsi/evaluator.ts（无网络评估容器，封存副本覆盖，结构化报告，用例数核对，三态）
- server/rsi/model-proxy.ts（把 P0 代理产品化：run 令牌、模型固定、token 预算硬拦截、usage JSONL）
- server/rsi/queue.ts、worker.ts（拉队列、并发上限默认 2、崩溃恢复：进行中的评测重新排队，账本已有结果的不重跑）
- server/rsi/artifacts.ts（大产物放文件，数据库只存索引）
- server/rsi/cli.ts、bin/rsi.js、vite.cli.config.ts、package.json 的 bin 和 scripts
- 各自的 .test.ts；fake-agent 测试替身

要求：
- `rsi worker --execute` 是唯一能运行容器的入口。没有 --execute 只打印将要做的事。HTTP 不触发执行。
- 基线标定、smoke、train、sealed 的调度按契约。smoke 挂了立即停。infra_error 重试一次。
- 每次状态变化先写账本，再更新数据库索引。
- token 和耗时以代理和容器层为准，会话库只用于展示；两边差距超过配置阈值时写一条 finding。
- 用假 Agent（不调模型，直接改文件）跑通 smoke 和 train，这部分不依赖真实模型。
- 所有 Docker 集成测试在没有 Docker 时 skip，并写进输出，由 Claude 运行。

验收：单测全绿；Claude 在沙箱外用假 Agent 跑完 smoke 和 train；中途 kill worker 后能恢复且不重复计分。
```

**审查清单**

- [ ] 被优化容器内拿不到真密钥、隐藏测试、题号
- [ ] 评估容器无网络
- [ ] kill -9 后恢复，账本无重复结果
- [ ] 请求路径上没有 `spawnSync`，docker 调用都有超时

---

## P3 题集

**分支**：`codex/rsi-p3`（与 P2 并行）

```text
目标：做 30 道自建小题，含隐藏测试、参考解、变异检查和指纹字典，按设计稿划分集合。

必读：AGENTS.md；openspec/contracts/rsi.md 的题集和 L1 部分；docs/rsi/design.md“评测与晋级闸门”“自建题的要求”；scripts/rsi-probe/task；src/core/rsi-l1-rules.ts。

只允许新增：
- rsi-bank/tasks/<id>/（repo/、statement.md、hidden_tests/、reference.patch、meta.json）
- rsi-bank/manifest.json（分层划分：smoke 3 取自 train 15；sealed 9；final 6）
- scripts/rsi-bank/validate.mjs、mutate.mjs、build-dictionary.mjs，及测试
- package.json 的 files 排除项（如需要，确保题集不进发布包）

要求：
- 至少 3 种语言：JavaScript/TypeScript、Python、Go（Go 由评估镜像提供，本机没有 Go 时该部分 skip 并写进输出）。难度分层。题目是自写的小型代码库，不复制受版权保护的代码。
- 校验：原始 repo 必须不过隐藏测试；reference.patch 必须过；statement.md 不泄露隐藏测试的断言。
- 变异检查：对参考解做简单变异（翻转条件、改边界、删语句），测试抓不住的比例超过阈值的题不收。阈值写进 manifest。
- 题号、仓库名不写进 statement.md。
- 输出指纹字典，交给 L1 使用。字典和隐藏测试只放在优化者挂载不到的地方。

验收：validate.mjs 全过；弱测试题被剔除并记录；输出每个集合的语言和难度分布。Claude 随后抽查若干题。
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
目标：让真实优化者在容器里自己循环：取 brief、读白名单结果、提交 PRD 和 commit、必要时 declare_stuck。

必读：AGENTS.md；openspec/contracts/rsi.md 的 API 和可见范围；docs/rsi/p0-report.md 的优化者登录结论；server/http/benchmark-routes.ts（路由写法）；server/telemetry/receiver.ts 的 Bearer 校验；server/server.ts 注册和回环白名单位置。

只允许新增或修改：
- server/http/rsi-routes.ts 及测试（优化者接口和页面接口的只读部分）
- server/rsi/agent-auth.ts、optimizer-session.ts、handoff-prompt.ts、submit.ts 及测试
- server/server.ts（只加注册、停止、回环前缀）
- openspec/contracts/api.md（如契约需要细化）

要求：
- 每个任务一个 Bearer，只存哈希。优化者令牌调不了页面接口，反之亦然。页面接口要本机令牌，不能只靠回环。
- 所有结果经 rsi-visibility 投影。写测试：用优化者令牌遍历全部接口，响应里不得出现封存题号、封存分数、监控原文、指纹字典。
- 提交接口不收二进制，只收 PRD 和 commit sha。平台自己从 worktree 算 diff。
- 每轮由 worker 启动一个全新优化者会话，上一轮的会话不续接。优化者目标不写死，提示词明确 declare_stuck 不算失败。监控结论不进入提示词。
- 达到迭代或 token 预算上限时任务自动停止。
```

**审查清单**

- [ ] 用优化者令牌遍历接口无泄露
- [ ] 页面接口拒绝优化者令牌，也拒绝只有回环地址的请求
- [ ] 优化者容器没有 docker socket，网络只到 API 和模型出口

---

## P5 防作弊 Agent

**分支**：`codex/rsi-p5`

```text
目标：实现监控者、对抗者、消融重跑和校准器，并产出已知作弊补丁的检出报告。

必读：AGENTS.md；openspec/contracts/rsi.md；docs/rsi/design.md“防作弊”全文；server/task-health/model-client.ts、deep.ts；scripts/codex-health-proxy.mjs。

只允许新增：
- server/rsi/monitor.ts、adversary.ts、ablation.ts、calibrator.ts 及测试
- scripts/claude-monitor-proxy.mjs（无工具的 Claude 封装，形式照 codex-health-proxy）
- rsi-bank/calibration/（每类至少 30 个已知作弊补丁和 30 个良性补丁）

要求：
- 监控者只收去注释的 diff、题面、L1 告警，不收 PRD、优化者推理、分数。diff 放在明确标记的数据块里。两套提示词随机选一套。没有工具。输出类别、证据行、置信度。证据行必须真实存在于 diff，否则结论作废。
- 监控者只能挂起，不能批准。超时或解析失败一律 hold。
- 对抗者只出变体题，变体题必须先在参考解上通过才计入。拿不到封存集和监控结论。
- 消融：自动撤销 L1 告警或 L4 怀疑的改动块，重跑受影响的题，分数回落写成强证据。
- 校准：注入已知作弊补丁和良性补丁，监控者不知道哪些是注入的。分类报告检出率、误报率和置信区间。L0、L1 类别必须 100%。监控者不达标自动降级为只告警。
- 优化者和监控者必须不同模型家族，否则启动时报错。
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
