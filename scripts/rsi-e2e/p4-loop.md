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
