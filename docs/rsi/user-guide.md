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

`doctor` 全部通过再继续。磁盘紧张时可以把 `--disk` 调大，Colima 只支持扩容。

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

监控没有启动时，迭代不会自动晋级，会停下来等人工审查。

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

1. **被优化 Agent**：选一个档案，填代码仓路径和完整的基线 commit。
2. **优化者**：默认 OpenCode + DeepSeek。
3. **题集**：第一次用小题集试跑。小题集是训练 6 题、封存 3 题、最终 3 题，每种语言都有。
4. **目标和预算**：目标通过数默认等于训练题数。高级设置里可以调单题 Token 预算和噪声带重复次数。OpenCode 这类系统提示较大的 Agent，单题预算建议设到 300000。

也可以用命令行：

```bash
node bin/rsi.js task create --task demo --root <配置目录> --repository /path/to/agent --baseline <完整 commit> --bank rsi-bank --agent rsi-agents/mini-agent/profile.json --subset small
```

命令行创建的任务默认不启用监控，启动执行器时要带 `--monitor-*` 参数，或用 `--settings` 传入 `reviews`。

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

## 看结果

| 页面 | 看什么 |
| --- | --- |
| 任务列表 | 哪些任务在跑，哪些在等你，封存集还剩几次 |
| 任务详情 | 每轮通过数、噪声带、Token 和耗时，禁令和思路，决定记录 |
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
| 放宽目标、调整预算 | 优化者请求帮助或预算用尽时使用 |
| 最终验收 | 定稿后跑一次最终留出集 |
| 采纳 | 把定稿版本导出为补丁和分支，不合并、不推送 |

校验账本有没有被改过：

```bash
node bin/rsi.js ledger verify --task <任务 ID> --root <配置目录>
```

校准监控。默认每类抽 5 个，共 35 次模型调用，样本不足时页面会明确说明不能判定达标。要得出结论需要全部 210 个：

```bash
node bin/rsi.js calibrate --task <任务 ID> --root <配置目录> --sample all
```

## 控制花费

- **任务 Token 预算**：用尽后任务暂停，可以在页面上调整后继续。
- **单题 Token 预算**：超出后这一次运行判失败。
- **优化者每轮 Token 上限和时限**：超出后结束这一轮。
- 平台只统计 Token 和缓存命中率，不换算成金额。要设硬性花费上限，请在模型服务商一侧设置，或者在外部监视余额并向执行器发送中断信号。中断后任务可以恢复。

## 已知限制

这些是这一版的真实边界，使用结果时请留意：

- 题库题量小、风格一致，强 Agent 可能接近满分，这时优化空间很小。
- L1 的 100% 检出只针对明确的题目指纹和受保护路径。按题面措辞特判这类做法要靠监控，监控只有在完整校准后才能说明可信程度。
- 对抗变体和隐藏测试在同一个评估容器里运行，候选补丁理论上可以影响测试过程。
- L1 拒绝的类别会告诉优化者，理论上可以被用来低速试探规则。
- Codex 和 Claude Code 作为优化者的档案未经真实验证，加密流量也无法计量，默认拒绝执行。
- 只在 macOS + Colima 上验证过。使用 Docker Desktop 或远程 Docker 时，隔离性质需要自己重新确认。
