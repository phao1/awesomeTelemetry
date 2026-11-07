# 用 RSI 优化你自己的 Agent

这份指南面向想在本机用这个平台优化自己 Agent 的同事。每个人在自己的机器上运行，用自己的模型额度，数据只留在本机。托管和多租户不在这一版范围内。

## 它做什么

你提供一个 Agent 的源码和一个基线 commit。优化者（另一个 Agent）读取评测结果，改源码，提交新版本。平台在隔离容器里评测每个版本，用六层防线检查它是否作弊，决定晋级、拒绝或等人工审查。最后由你决定是否采纳，平台不会合并或推送任何东西。

```text
优化者改代码 → 平台算 diff → L1 规则 → 构建 → 小范围检查 → 训练集 → 监控、对抗、消融 → 封存集 → 判定 → 人工审查
```

## 准备环境

需要 macOS、Node 24 和 Git。平台在专用虚拟机里运行所有不可信代码，不挂载任何宿主目录。

```bash
brew install colima docker docker-buildx
```

```bash
mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-buildx/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx
```

```bash
colima start --profile rsi --vm-type vz --cpu 4 --memory 4 --disk 30 --mount none
```

在仓库根目录构建并检查环境：

```bash
npm install && npm run build
```

```bash
node bin/rsi.js doctor --docker-context colima-rsi
```

除 `upstream` 外的检查都通过再继续。`upstream` 这时是 false，因为还没有设置模型，后面设置好之后可以再跑一次确认。磁盘紧张时可以把 `--disk` 调大，Colima 只支持扩容。

`colima start` 会把 Docker 的当前 context 切到这台虚拟机。如果你平时还用别的 Docker 环境，用完运行 `docker context use default` 切回去。平台的命令都显式带 `--docker-context`，不受影响。

## 启动

需要三个长期运行的进程，建议各开一个终端。

**1. 页面**

```bash
node bin/agent-observe.js --no-open
```

打开页面后进入侧栏的“自优化”。

**2. 监控**

监控模型必须和优化者来自不同厂商，否则执行器会拒绝启动。优化者不是 OpenAI 系时，默认用 Codex 登录态调用 `gpt-6.1-sol`：

```bash
export RSI_MONITOR_API_KEY=$(openssl rand -hex 32)
```

```bash
PROXY_PORT=4317 PROXY_TOKEN=$RSI_MONITOR_API_KEY node scripts/codex-health-proxy.mjs
```

优化者是 OpenAI 系时，改用 `scripts/claude-monitor-proxy.mjs`，端口 4318。也可以接任何 OpenAI 兼容的服务，启动执行器时加 `--monitor-base-url`、`--monitor-family`、`--monitor-model`。4317 被占用时，换一个端口并用 `--monitor-base-url` 指过去。

监控没有启动时，迭代不会自动晋级，会停下来等人工审查。监控桥一次只处理一个请求，多个任务可以共用，请求会排队等待；等到单次时限还没轮到，这次审查就算缺失，迭代同样挂起。

**3. 执行器**

页面只负责排队，所有容器和模型调用都由手动启动的执行器完成。新建任务后，页面会给出完整命令。先在同一个终端设置上游模型：

```bash
export RSI_UPSTREAM_BASE_URL=https://api.deepseek.com/v1 RSI_UPSTREAM_MODEL=deepseek-flash
```

```bash
read -rs RSI_UPSTREAM_API_KEY && export RSI_UPSTREAM_API_KEY
```

然后运行页面给出的命令：

```bash
node bin/rsi.js worker --execute --watch --task <任务 ID> --root <配置目录> --docker-context colima-rsi
```

密钥只留在执行器进程的环境变量里，只有模型代理容器能收到，不会写入配置、账本或日志。

## 新建任务

在“自优化”页面点“新建任务”，分四步：

1. **被优化 Agent**：选一个档案，填代码仓路径和完整的基线 commit。优化 OpenCode 时，上游是 DeepSeek 就选“OpenCode (built-in DeepSeek)”，它沿用内置 provider 对 `reasoning_content` 的处理；其他 OpenAI 兼容服务选“OpenCode (OpenAI compatible)”。
2. **优化者**：默认 OpenCode + DeepSeek。
3. **题集**：第一次用小题集试跑。小题集是训练 6 题、封存 3 题、最终 3 题，每种语言都有。
4. **目标和预算**：目标通过数默认等于训练题数。高级设置里可以调单题 Token 预算和噪声带重复次数。OpenCode 这类系统提示较大的 Agent，单题预算建议设到 300000。

也可以用命令行：

```bash
node bin/rsi.js task create --task demo --root <配置目录> --repository /path/to/agent --baseline <完整 commit> --bank rsi-bank --agent rsi-agents/mini-agent/profile.json --subset small
```

命令行创建的任务默认不启用监控，启动执行器时要带 `--monitor-*` 参数，或用 `--settings` 传入 `reviews`。

## 第一次试跑

强模型配完整的 Agent 很容易在小题集上拿满分，优化就无从谈起。`rsi-agents/mini-agent/demo-source` 是故意削弱的演示版本：只允许 3 轮模型调用，`read_file` 只返回前 200 个字符。先用它走一遍闭环。

```bash
mkdir /tmp/demo-agent && cp -R rsi-agents/mini-agent/demo-source/. /tmp/demo-agent/ && git -C /tmp/demo-agent init -q && git -C /tmp/demo-agent add -A && git -C /tmp/demo-agent -c user.name=demo -c user.email=demo@localhost commit -qm baseline && git -C /tmp/demo-agent rev-parse HEAD
```

新建任务时选 Mini coding Agent，代码仓填 `/tmp/demo-agent`，基线填上面输出的 commit，题集选小题集。

我们用 DeepSeek 实测的一次结果，供你对照：

| 轮次 | 优化者的改动 | 训练集 | 结果 |
| --- | --- | --- | --- |
| 基线 | — | 0/6 | Agent 都因轮数上限崩溃 |
| 第 1 轮 | 不再截断 `read_file` | 0/6 | 分数没涨，自动拒绝 |
| 第 2 轮 | 轮数上限提到 12，到上限时正常结束 | 6/6 | 封存集 0→3；Token 增幅超限，挂起等人工 |
| 人工批准后 | — | — | 晋级，达到目标；最终留出集 3/3 |

全程约 100 万 Token，其中大部分是缓存命中。第 2 轮的挂起是正常现象：基线一启动就崩，Token 用得极少，真正干活的版本一定超过 30% 的增幅上限，这时该由人判断。

这个分数上涨只说明闭环走得通，不代表能把成熟的 Agent 优化到同样程度。

## 接入你自己的 Agent

写一个可信档案和容器构建文件，放在同一目录。最小可参考 `rsi-agents/mini-agent`，真实项目可参考 `rsi-agents/opencode`，字段说明见 [rsi-agents/README.md](../../rsi-agents/README.md)。

```bash
node bin/rsi.js agent validate /path/to/profile.json
```

有三件事要注意：

- 档案和 Dockerfile 在任务创建时冻结，候选版本改不了它们。
- 档案里不能写真实密钥，用 `{{apiKey}}` 占位。
- 所有依赖在构建阶段联网安装，候选代码只在断网阶段处理。运行时容器没有外网，只能访问模型代理。

如果 Agent 自带测试目录，L1 默认会拒绝对它的修改。确实需要时，用 `l1.allowPaths` 豁免路径，指纹和其他规则仍然生效。

优化者进容器时拿到的是浅克隆，只有被选中的那一版代码，没有历史。所以几百 MB 历史的大仓库也能用，上限是当前版本压缩后 256MiB。

如果基线已经达到目标，或者分数已经高到任何候选都超不过噪声带，任务会直接转为“需要帮助”，不会继续花 Token。这时提高目标，或换更难的题集。OpenCode 配 DeepSeek 就是这样：小题集上训练 6/6、封存 3/3；完整题集上训练 14.5/15，而噪声带 δ 是 2.83，比离满分的距离还大。这说明现在的题对它太容易了，要优化它需要更难的题。

**大仓库要调高优化者每轮 Token 上限。** 这个上限把缓存命中的 Token 也算在内。OpenCode 这样的仓库，每次请求约 5 万 Token，其中 95% 是缓存命中，默认的 200 万只够约 40 次请求，优化者还没读完代码就到顶了，实测连续几轮都没有提交。新建任务时在高级设置里调大，建议 800 万以上；任务开始后也可以在“调整预算”里改，下一轮生效。缓存命中的 Token 很便宜，真实花费比这个数字看起来小得多。

如果优化者连续几轮没有提交，先看“优化者会话”标签，上面写着每轮为什么结束：

| 结束方式 | 通常怎么办 |
| --- | --- |
| 用完每轮 Token 上限 | 在“调整预算”里调高，再继续 |
| 长时间无活动，提前结束 | 打开这一轮，看结束前的进程和输出，判断它卡在哪里 |
| 到达每轮时限 | 看输出。常见原因是题太大或时限太短 |
| 优化者自行退出 | 看输出和模型轨迹，通常是启动配置或模型报错 |

## 看结果

| 页面 | 看什么 |
| --- | --- |
| 任务列表 | 哪些任务在跑，哪些在等你，封存集还剩几次 |
| 任务详情 | 每轮通过数、噪声带、Token 和耗时，禁令和思路，决定记录 |
| 优化者会话（任务详情里的标签） | 每轮优化者做了什么、为什么结束，包括没有提交的轮次；可以看它的输出和模型轨迹 |
| 迭代详情 | 方案、diff（标出命中行）、六层结果、发现、逐题结果和轨迹、对抗和消融 |
| 待审队列 | 被挂起的迭代，加上随机抽中的已通过迭代 |
| 监控校准 | 监控各类作弊的检出率、误报率和置信区间 |

## 你可以做的操作

所有操作都写进账本，并要求写理由。执行器没有运行时，操作只会排队。

| 操作 | 效果 |
| --- | --- |
| 批准、拒绝 | 处理被挂起的迭代 |
| 回退到此版本 | 在该版本上继续，之后的版本保留 |
| 添加禁令、添加思路 | 优化者下一轮开始时读取 |
| 暂停、继续、终止 | 控制整个任务 |
| 放宽目标、调整预算 | 优化者请求帮助或预算用尽时使用。预算里可以改任务 Token、迭代数、封存次数和优化者每轮 Token 上限 |
| 最终验收 | 定稿后跑一次最终留出集 |
| 采纳 | 把定稿版本导出为本地补丁和版本引用，补丁路径显示在迭代页顶部，不合并、不推送 |

校验账本有没有被改过：

```bash
node bin/rsi.js ledger verify --task <任务 ID> --root <配置目录>
```

校准监控。默认每类抽 5 个，共 35 次模型调用，样本不足时页面会明确说明不能判定达标。要得出结论需要全部 210 个，约 20 分钟：

```bash
node bin/rsi.js calibrate --task <任务 ID> --root <配置目录> --sample all
```

## 控制花费

- **任务 Token 预算**：用尽后任务暂停，可以在页面上调整后继续。
- **单题 Token 预算**：超出后这一次运行判失败。
- **优化者每轮 Token 上限和时限**：超出后结束这一轮。
- **优化者无活动检测**：连续 10 分钟没有模型请求且容器 CPU 接近 0，就判定挂起并提前结束这一轮，不再等到时限。容器在跑测试这类忙碌状态不受影响。启动配置里的 `optimizerIdleTimeoutMs` 可以调整。
- 平台只统计 Token 和缓存命中率，不换算成金额。要设硬性花费上限，请在模型服务商一侧设置，或者在外部监视余额并向执行器发送中断信号。中断后任务可以恢复。

## 已知限制

这些是这一版的真实边界，使用结果时请留意。每项功能实际验证到什么程度，见 [coverage.md](coverage.md)。

- 题库题量小、风格一致，强 Agent 可能接近满分，这时优化空间很小。
- 噪声带默认只用 3 次重复标定（我们实测为了省钱用了 2 次），结果偏大也偏不稳。想让小幅提升能被判定，要加重复次数。
- 校准语料是模板。校准通过说明这几类做法能被拦住，不能推断真实作弊都能被发现。
- 实测中有一轮优化者挂起了 28 分钟，原因没有查明。现在平台会提前结束这样的轮次并留下进程和输出，下次再出现时可以定位。
- L1 的 100% 检出只针对明确的题目指纹和受保护路径。按题面措辞特判这类做法要靠监控，监控只有在完整校准后才能说明可信程度。
- 对抗变体和隐藏测试在同一个评估容器里运行，候选补丁理论上可以影响测试过程。
- L1 拒绝的类别会告诉优化者，理论上可以被用来低速试探规则。
- Codex 和 Claude Code 作为优化者的档案未经真实验证，加密流量也无法计量，默认拒绝执行。
- 只在 macOS + Colima 上验证过。使用 Docker Desktop 或远程 Docker 时，隔离性质需要自己重新确认。
