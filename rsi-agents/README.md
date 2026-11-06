# RSI Agent 档案作者指南

平台按被冻结的 Agent 档案构建每一个被优化 commit。档案由可信的平台操作者提供，
候选只能修改被优化仓库；档案和 Dockerfile 在任务创建时冻结，不能随候选变更。
权威接口见 `openspec/contracts/rsi.md` RSI-013。没有新增运行时依赖。

```sh
node bin/rsi.js agent validate rsi-agents/mini-agent/profile.json
node bin/rsi.js doctor --docker-context colima-rsi
node bin/rsi.js task create --task demo --repository /path/to/agent-source \
  --baseline <full-commit> --bank /path/to/rsi-bank \
  --agent rsi-agents/mini-agent/profile.json --subset small
node bin/rsi.js worker --task demo
node bin/rsi.js worker --task demo --execute --docker-context colima-rsi
```

档案与 Dockerfile 同目录。`version: 1`；`id` 为 1–128 位字母数字、下划线或连字符；
`name` 为显示名称；`dockerfile` 为安全的相对路径。其余字段可参考两个完整示例。
未知字段、未知占位符、路径穿越、链接和缺失 stage 都会报出字段位置。
校验器不能证明 Dockerfile 的全部安全性质，操作者必须审阅 Dockerfile。

`run.argv` 是直接交给 Docker exec 的字符串数组。支持 `{{statement}}`、`{{model}}`。
`run.env` 和 `run.files[].content` 支持：

| 变量 | 值 |
| --- | --- |
| `{{baseUrl}}` | `http://rsi-proxy:8080/v1` |
| `{{apiKey}}` | 每个 run 新生成的临时令牌 |
| `{{model}}` | mock 为 `fixed`，真实模式为 worker 环境的 `RSI_UPSTREAM_MODEL` |
| `{{sessionDir}}` | `session.dir` |

只做一次字面字符串替换，不递归展开、不经过 shell。题面含引号、`$()` 或空格不会
变成命令；Agent 自己的 shell 工具当然仍会在隔离容器内执行模型请求的命令。
文件路径和 `session.dir` 必须为规范的容器绝对路径。文件通过 tar 写入，runtime 用户
必须能创建其父目录；镜像须让 `/data` 等会话目录可写。`session.format` 为
`opencode-db` 时读取导出的 session.db；`none` 仍导出会话目录，但仅用代理 token，
不会因缺失原生 token 写对账 finding。

不得填入任何真实密钥。API key/token/secret/password 必须使用 `{{apiKey}}`，
校验器会拒绝常见的字面凭据。真实上游的 `RSI_UPSTREAM_BASE_URL`、
`RSI_UPSTREAM_MODEL`、`RSI_UPSTREAM_API_KEY` 只从 worker 自身环境读取，只有模型代理
收到它们，不写 settings、runtime、日志或账本。不要读取或挂载宿主凭据目录。

Dockerfile 必须定义 `target-node`、`target-python`、`target-go`。上下文只有 `source/`、
`deps/` 与可信 Dockerfile。镜像须具备 git、tar、sleep，使用有可写临时目录的普通用户，
默认 `ENTRYPOINT ["sleep", "infinity"]`。运行时不能安装依赖。
所有内置 Go stage 与 evaluator 统一使用：

```dockerfile
COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOMAXPROCS=1 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
```

依赖输入选择：

- `bun-workspace`：沿用 package/workspace、锁文件和被引用依赖补丁的收集逻辑。
- `globs`：`include` 仅复制匹配文件。`*` 不跨目录，`?` 匹配单字符，`**/` 可匹配零层目录。
- `none`：deps 为空目录；适用于无依赖的 mini-agent。

任何模式都不会把任意深度的 `.npmrc`、`bunfig.toml` 放入 deps。
联网层只能接收筛过的 deps，固定 registry、禁用生命周期脚本。**所有候选代码、构建配置、
依赖后处理与编译必须在 `RUN --network=none` 中执行**。否则仓库里的安装脚本就能
在联网层访问外界，绕过运行时隔离；仅把最终容器断网不足以隔离构建过程。
OpenCode 仅在离线阶段执行 fix-node-pty 和编译；mini-agent 离线检查语法并设置可读权限。

档案不能放宽平台的 internal 网络、无挂载、cap-drop ALL、no-new-privileges、资源限制。
数据走 tar/stdin；最终 patch 由 git add -A 后的 cached binary diff 导出。
模型请求都过代理；代理保留 usage.jsonl、responses.jsonl 和最后一次累积 messages，
后两者各限 8MiB，截断会标记，位于 run artifacts 的 proxy/ 目录，均为私有人工诊断资料。
不记录 Authorization 头，不暴露给优化者 DTO。

`l1.allowPaths` 使用同一套简单 glob，仅豁免匹配路径的 protected_path，例如 Agent
自带的测试目录；指纹、依赖、二进制、链接、文件模式和大小限制仍然执行。

`--subset` 默认 full。small 保留全部 smoke，再按 manifest.questions 顺序为 train
每种语言补一道非 smoke 题，sealed/final 各取每种语言第一题；split 内保留原顺序。
子集内容、manifest、datasetHash 和指纹字典创建后一起冻结。smokeFloor 是基线标定
每次都通过的 smoke 题数，候选通过数达到它即可继续 train。

OpenCode 的 `profile.json` 用通用兼容 provider 对接假模型。真实 DeepSeek 使用
`profile.deepseek.json`，内置 deepseek provider、`deepseek/deepseek-flash`，只覆盖
baseURL/apiKey，从而沿用 reasoning_content 等 provider 行为；见 P0 报告。
