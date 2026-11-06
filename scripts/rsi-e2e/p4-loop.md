# P4 隔离闭环验收

由 Claude 在沙箱外运行（本次 Codex 未运行 Docker、绑定端口或访问网络）：

```sh
export PATH="/Users/penghao/Documents/dshProject/dshPluginSecrete/.tools/node-v24.19.0-darwin-arm64/bin:$PATH"
node scripts/rsi-e2e/p4-loop.mjs --docker-context colima-rsi
```

可传 `--root <全新目录>`、`--report <报告文件>`。需要 Docker/buildx、Linux engine、
镜像构建网络和本地 git；不需要真实密钥。脚本用 Vite 生成临时可信入口，启动真实
HTTP 服务和独立 `worker --execute --watch`，经页面接口冻结任务，mini-agent 为被优化
对象、scripted 为优化者、small 子集、真实旁路容器和内部假模型。默认 ReviewProvider
保持 missing；三次假设都没有训练增益，在监控之前拒绝，第四次新会话经 stuck 请求帮助。
不注入 clean review，不绕过判定。

每轮脚本直接探测三种宿主地址上的已确认存活回环端口，任何成功都阻止提交并使验收失败；
同时验证旁路只转发 agent 前缀、页面接口404、IP CONNECT 拒绝。通过接口检查三轮终态、
质量产物、worker 心跳；Ctrl-C 后检查停止状态与有标签的容器/网络清理。

报告保留在临时根目录，不记录令牌或金额。默认优化者 OpenCode/DeepSeek 的镜像安装及真实
循环、Codex/Claude Code 登录与白名单仍需分别实测；后两者明确标为“未实测”，运行必须
显式允许 unmetered。会话原生用量只是 self_reported 诊断，不参与预算或判定。

新任务默认真实模型代理。真实执行示例（任务须先经 HTTP 或 task create 创建）：

```sh
RSI_UPSTREAM_BASE_URL=https://api.deepseek.com/v1 \
RSI_UPSTREAM_MODEL=deepseek-flash \
RSI_UPSTREAM_API_KEY='<仅在本机环境提供，不写文件>' \
node bin/rsi.js worker --execute --watch --task <taskId> --root <服务数据库所在目录> --api-base http://127.0.0.1:4173 --docker-context colima-rsi
```

上面是占位示例，真实密钥仅经环境注入。HTTP 服务不需要上游密钥，只有 worker 为模型
旁路容器传递；本 E2E 显式选择 mock，不会访问真实模型。


P4/P5 合并验收可选开关（仍由 Claude 在沙箱外执行）：

```sh
node scripts/rsi-e2e/p4-loop.mjs --fake-monitor --docker-context colima-rsi
```

该模式使用三语言微型题库、mini-agent 和 scripted 优化者，启动本机回环假监控模型。
实际执行 AgentReviewProvider、过程轨迹读取、对抗题资格验证、父代/候选对抗评测、封存和
晋级，并验证人工 audit 项仍排队。服务只替换模型传输，绝不注入 clean ReviewProvider。
无开关时仍是原来的三轮拒绝后 stuck。假目标模型用通用常量修复命令及显式 '*' mock
回退处理生成题号；不改变真实模型分支，不声称这些假模型能识别真实作弊。

审查是显式启用：可信 private/runtime.json 的 reviews:{} 开启按档案家族选择的默认值；
未配置 reviews 时仍 MissingReviewProvider。DeepSeek 默认 OpenAI 4317；OpenAI 优化者
默认 Anthropic 4318（scripts/claude-monitor-proxy.mjs，默认 claude-sonnet-4-5）。可用
--monitor-family、--monitor-base-url、--monitor-model 覆盖；不再接受 --optimizer-family。
同家族在启动时拒绝。`rsi calibrate --task <id> --sample all` 使用相同配置和 token 账本；
默认每类5条仅报告样本不足，不会隐式开启 worker 的审查。
