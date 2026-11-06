# RSI P2 Docker smoke

由 Claude 在 Codex 沙箱外执行。需要 Node 24、Git、可用的 Linux Docker engine、
P0 的 4 核/4GB VM 基准、约 30GB VM 磁盘，以及包含 P0 固定 commit
`4d30794bcf4dccdcadbcb1f62bb35b4943a96426` 的 OpenCode 本地仓库。
只使用脚本化假模型，不需要厂商密钥，不访问或挂载宿主凭据目录。

```sh
export PATH="/Users/penghao/Documents/dshProject/dshPluginSecrete/.tools/node-v24.19.0-darwin-arm64/bin:$PATH"
npm run build:rsi
node scripts/rsi-e2e/p2-smoke.mjs \
  --repository /path/to/opencode \
  --docker-context colima-rsi \
  --root /tmp/rsi-p2-new-run \
  --report /tmp/rsi-p2-report.json
```

从 awesomeTelemetry 仓库根目录执行。`--root` 必须是新的独立目录；省略时创建临时目录。
建议使用专门的 RSI Docker context；该 context 的共享构建缓存会修剪到 6GB，
包括其中其他构建的缓存（不删除其他镜像/容器）。Docker 默认 context 可省略 `--docker-context`。缺少 Docker 明确失败，不跳过。
首次构建可超过 10 分钟；子 worker 的上限为一小时。日志和测试产物保留在 root，
JSON 报告只包含 token/状态，不包含 bearer、厂商密钥或金额。不要将整个 root 公开发布。

脚本先建立独立裸仓库副本，用 Git plumbing 产生一个文本候选 commit，不修改原仓库。
题库只使用 `server/rsi/__fixtures__/bank/` 的九道小题。baseline 表中一题按
`fail/pass/fail` 变化，所以 δ 非零；candidate 表全部通过。它验证调度/隔离基础设施，
不证明实际模型或候选算法质量。

流程断言：dry-run；基线 train 第一个槽位入账后，屏障在 worker --execute 内创建一个带任务 label 的
空闲隔离容器/网络，再 kill -9；恢复到并发 2 并确认清理真实遗留资源；
基线 train R 次、sealed 3 次；smoke、train；默认缺审查转 held 且不消耗候选 sealed；
本机 human retry_review；通过参数注入可信假 ReviewProvider；sealed 3 次、晋级、目标完成；
账本验证；再次启动不重复执行/计费；没有残留容器。测试屏障只通过测试 harness 的
函数参数注入，没有 CLI 绕过审查的选项。

可选的 Vitest 外部集成入口：

```sh
RSI_DOCKER_E2E=1 OPENCODE_SRC=/path/to/opencode \
  npx vitest run --configLoader native --no-cache scripts/rsi-e2e/p2-smoke.test.ts
```

沙箱内默认跳过这一项；其余假 Docker、代理流、实际本地报告器测试照常运行。

## 本机 CLI

```sh
node bin/rsi.js task create --task demo --repository /path/to/local-repo \
  --baseline <full-sha> --bank /path/to/rsi-bank --settings /path/to/settings.json
node bin/rsi.js worker --task demo
node bin/rsi.js worker --task demo --execute
node bin/rsi.js task status --task demo
node bin/rsi.js iteration submit --task demo --commit <full-sha> \
  --prd /path/to/prd.json --request attempt-1
node bin/rsi.js ledger verify --task demo
```

WorkerSettings 完整字段/默认值见 `openspec/contracts/rsi.md` RSI-012。
`imagesRoot` 和 `reportersRoot` 使用绝对路径时可从任意目录启动。
正常启动遇到 partial_tail 会拒绝执行。确认 worker 已停止后，由人显式执行：

```sh
node bin/rsi.js ledger recover --task demo
```

它先隔离残留字节再截断，仅接受 partial_tail，不修复哈希/anchor 损坏。
未知/存活 owner 的锁不会被移除。遗留锁损坏时保留现场，由操作者检查处理。

## 构建与第三方脚本

联网层只接收允许的依赖元数据/补丁，禁用生命周期脚本，固定 npm registry。
候选 `.npmrc`、`bunfig.toml` 留在离线层。OpenCode 的 fix-node-pty 后处理只在
`RUN --network=none` 执行，用于 `@lydell/node-pty` 的 spawn-helper 权限。
没有启用其他第三方生命周期脚本。真实 Docker 构建若发现依赖脚本还必须联网，
应报告具体依赖和原因；不要扩大联网层。

真实模型 token 估计、native binary 安装、镜像构建、网络隔离与资源峰值都需要外部验证。
代理 admission 使用可配置并按 usage 校准的输入估计；未知厂商 tokenizer 的单次低估
仍可能使最终 usage 高于预留，随后会全额入账并阻止后续请求。这一限制已列入 RSI-012。
