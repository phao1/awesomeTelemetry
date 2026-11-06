# RSI P0：Claude 沙箱外实测手册

本阶段只检验环境，不接入产品代码，不提交。以下命令从 `awesomeTelemetry`
的 `codex/rsi-p0` worktree 根目录执行。实现及字段见 `scripts/rsi-probe/README.md`。
未执行 Docker 前，不宣称 M1 8GB 方案可行。不要开启 `set -x`，不要打印环境变量、
`docker inspect` 的完整 Config，或读取/复制宿主 `~/.codex`、`~/.claude`、`~/.ssh`。

## 1. 本机静态验证

```bash
export PATH="/Users/penghao/Documents/dshProject/dshPluginSecrete/.tools/node-v24.19.0-darwin-arm64/bin:$PATH"
node --version
find scripts/rsi-probe -name '*.mjs' -not -path '*/out/*' -exec node --check {} \;
find scripts/rsi-probe -name '*.sh' -exec bash -n {} \;
node --test scripts/rsi-probe/*.test.mjs scripts/rsi-probe/proxy/*.test.mjs
node scripts/rsi-probe/validate-task.mjs
npm run typecheck
npx eslint scripts/rsi-probe
npx vitest run scripts/rsi-probe src/catch-guard.test.ts src/styles
```

预期：语法检查、lint、typecheck、Vitest 成功；node:test 的端口集成占位项有
明确 skip 原因。样题输出 `valid:true`，original `fail/exitCode:1/observedTests:5`，
reference `pass/exitCode:0/observedTests:5`。`out/task-validation.json` 保存证据。
Vitest 配置只收集 `.test.ts/.tsx`，所以 `.test.mjs` 必须用上面的 node:test 单独运行。
本 worktree 的 node_modules 可能指向只读共享目录。若上述常规命令因缓存写入
EPERM 失败，可保持原配置和断言，用以下等价检查，并记录常规命令的失败原因：

```bash
mkdir -p scripts/rsi-probe/out
npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile scripts/rsi-probe/out/tsconfig.app.tsbuildinfo
npx tsc -p tsconfig.node.json --noEmit --tsBuildInfoFile scripts/rsi-probe/out/tsconfig.node.tsbuildinfo
npx vitest run --configLoader runner scripts/rsi-probe src/catch-guard.test.ts src/styles
```

不在宿主工作树执行 git apply，也不创建宿主 `.git`。

## 2. 启动专用 VM 并核验挂载

若未安装 Docker CLI/Colima，先在宿主手动安装（这是环境准备，探针不自动装）。

```bash
command -v docker
command -v colima
bash scripts/rsi-probe/colima-start.sh
colima list
docker --context colima-rsi info --format '{{.OSType}} {{.Architecture}}'
colima ssh --profile rsi -- mount
```

预期：profile 为 `rsi`，vz、4 CPU、4 GiB，Docker 为 Linux aarch64。
脚本用 `--mount none`，不挂载任何宿主目录，数据只走 docker cp 或 stdin。
**人工核验实际 mount 输出**：不应出现整个 `/Users/penghao`、宿主仓库、凭证目录。
若旧 rsi profile 已配置过 HOME 挂载，先停止并人工修正其配置后重启；不要带着
不符预期的挂载继续。脚本不会删除已有 profile/磁盘，也不会切换全局 Docker context。

先查看空闲内存，记录宿主自身压力；VM 峰值并不等同于 macOS 总压力：

```bash
memory_pressure
vm_stat
```

保留终端日志或 Activity Monitor 截图。若已明显交换/卡顿，先结束其他工作负载再测。

## 3. 宿主回环哨兵和不可见文件

终端 A（保持运行）：

```bash
export RSI_HOST_PORT=18765
node scripts/rsi-probe/host-sentinel.mjs
```

预期单行 JSON：`{"listening":"127.0.0.1","port":18765}`。端口占用时明确报错。
只监听回环，不向网络暴露文件。

终端 B（之后所有 run-probe 命令在此执行）：

```bash
export RSI_HOST_PORT=18765
export RSI_HOST_CANARY="$(mktemp /tmp/rsi-host-canary.XXXXXX)"
printf 'host-only\n' > "$RSI_HOST_CANARY"
curl --fail --noproxy '*' "http://127.0.0.1:$RSI_HOST_PORT"
export OPENCODE_SRC=/Users/penghao/Documents/code/CodingAgent/opencode/opencode
git -C "$OPENCODE_SRC" rev-parse HEAD
```

预期 curl 输出 `rsi-host-sentinel`；commit 为
`4d30794bcf4dccdcadbcb1f62bb35b4943a96426`。canary 是一次性文件，无任何凭证。
编排器会独立验证哨兵存活和 marker，避免“服务没启动所以隔离通过”。
awesomeTelemetry 默认端口为 4173；若要判断它的实际可达性，也先在宿主确认该服务
正常监听。未启动时的 4173 阻断只能证明连接失败，不能证明防火墙有效，必须备注。

## 4. 单并发假模型闭环

```bash
node scripts/rsi-probe/run-probe.mjs --concurrency 1 --model mock
node -e 'const r=require("./scripts/rsi-probe/out/probe-report.json"); console.log(JSON.stringify({verdict:r.verdict,builds:r.builds,peaks:r.memoryPeakBytes,runs:r.runs.map(x=>({id:x.runId,evaluation:x.evaluation,tokens:x.reconciliation,error:x.error})),errors:r.errors},null,2))'
```

首次需要网络拉镜像/安装锁定依赖/编译；45 分钟构建上限。构建日志在
`out/rsi-*.build.log` 和 `out/rsi-*.build.stderr.log`。报告分别给出每个镜像构建时长、
镜像大小。缓存重建速度不能当作首次构建速度。若构建失败，修复源码适配后重跑，
不要临时给运行中的 target 开公网。若源码证明无法预置启动依赖，停止并反馈。

预期：最终 JSON `verdict:pass`、退出码 0；报告保留：

- 每个 target 仅有 internal 网络，无宿主挂载。proxy 同时接 internal 和 bridge，
  没有宿主发布端口；真实密钥只允许进入 proxy。
- `isolation.jsonl` 中公网 IP/DNS、宿主别名/固定 IP/internal 网关的哨兵和 4173、
  docker socket、宿主 canary 全部符合 blocked/false，proxy reachable。
- target 执行 `opencode run --standalone --auto --format json`，固定 provider/model。
  每个 run 随机工作路径、临时令牌、独立 DB；没有题号环境变量。
- `workspace.patch` 修改 clamp，target 销毁后才创建无网络 evaluator。封存测试在
  应用 diff 后注入，5 用例全过，无 skip/todo/cancelled。原始题和参考解已独立验证。
- `data/` 有 DB 和可能的 WAL/SHM；token 与代理累计精确对上。OpenCode 辅助标题调用
  也会计入，不能把它们从对账里偷偷排除。缺 usage 或不完整响应不能算对账成功。
- 内存报告有 VM 与容器采样；OOM、启动失败、采样失败、对账缺失应调查。
  任何宿主访问检查实际 reachable 时停止 real 测试，先修隔离。

默认预算每 run 100000；proxy 输出上限 1024。代理采用保守字节预留，不能当作
任意模型精确 tokenizer 的证明；P2 前要结合 real 上游用量验证其边界。

编排器正常失败也写 `out/probe-report.json` 并返回非零；Agent 超时是 fail，
基础设施错误是 infra_error，评估 infra_error 在新容器重试一次。
结束后应没有本轮容器和网络：

```bash
docker --context colima-rsi ps -a --filter label=rsi-probe=true
docker --context colima-rsi network ls --filter label=rsi-probe=true
```

若中断/强杀造成残留，先查看这些命令的对象；确认全部属于此次探针后，逐个执行
`docker --context colima-rsi rm -f <容器名>` 和
`docker --context colima-rsi network rm rsi-probe-net`。不要运行全局 prune。
编排器不会接管或删除启动前已存在的同名网络。

## 5. 并发 2 和重复观察

先将完整 out 目录复制到 worktree 外的受控位置（包括日志和 DB，不只复制报告），
每次记录不同存档目录。下一次会覆盖同名 out 产物。

```bash
node scripts/rsi-probe/run-probe.mjs --concurrency 2 --model mock
memory_pressure
vm_stat
```

预期有两个独立 run，均 pass、精确对账、无 OOM；检查两个 target 的执行区间和
stats 采样是否重叠。至少再重复两次并发 2，记录宿主是否明显卡顿、交换是否持续
增长、峰值和时长是否稳定。mock 的稳定不能代表 real 模型复杂轨迹稳定。
若并发 2 不稳定，而 1 稳定，P0 建议降到 1 或外置评测机，不硬撑。

## 6. 真实模型（用户配置可用时）

保持哨兵运行。通过安全终端提示输入真实密钥，不放命令参数、不写 env 文件：

```bash
export RSI_UPSTREAM_BASE_URL=https://YOUR-PROVIDER.example/v1
export RSI_UPSTREAM_MODEL=YOUR-EXACT-MODEL
read -r -s -p 'Upstream key: ' RSI_UPSTREAM_API_KEY
printf '\n'
export RSI_UPSTREAM_API_KEY
node scripts/rsi-probe/run-probe.mjs --concurrency 1 --model real
unset RSI_UPSTREAM_API_KEY
```

上面的 `read -p` 使用 bash 语法；zsh 用户先进入 `bash` 后执行本节命令。
上游须支持 OpenAI chat completions、tool calls、SSE usage。
缺任一项环境变量明确报错并写报告；URL 必须 HTTPS，不得含密钥/用户信息/query。
密钥只通过 Docker CLI 继承环境进入 proxy，target 只收到临时令牌；不打印完整
容器 inspect/env。报告不包含真实上游模型地址、密钥或金额。

先确认单并发成功、每项隔离通过、usage 完整、delta=0，再存档并以同样方式测
real 并发 2。记录真实模型单题时间和峰值；上游不发 usage 时结果应标异常，
不要从估算 token 伪造对账。若上游采用其他 usage 语义，保留脱敏样本后修解析。

## 7. 优化者 Codex Linux 探针

不读取宿主登录文件。由 Claude 设置本次要验证的明确 Codex CLI npm 版本，
记录该版本；账号和订阅方案仍由用户决定，不自动取 latest：

```bash
export RSI_CODEX_VERSION=REPLACE_WITH_EXPLICIT_VERSION
bash scripts/rsi-probe/optimizer-probe.sh
cat scripts/rsi-probe/out/optimizer-report.json
```

预期构建新 Linux arm64 镜像，干净 `--network none` 容器内运行 Codex version/help。
`optimizer-help.log` 保留该版本实际提供的登录选项。
`linuxCliRuns:true` 只证明能启动；`status:needs_decision`、两个 `authenticated:false`
必须保留，不得报告“订阅登录成功”。报告列出尚需用户决定的事项：

- API 路径：临时令牌、Codex Responses 兼容代理；P0 OpenCode chat 代理不能直接复用。
  真 API key 仍只留代理。需要端到端推理再确认模型权限和日志 token 统计。
- 订阅路径：用户选择在全新容器内交互式/设备登录及账号；先设置仅允许厂商域名
  的出口，再实际登录。根据此版本 help 决定 device-auth 是否可用。
  登录数据只留容器内；不拷宿主 auth.json。订阅请求不经过模型代理时，token
  必须从该新会话日志统计，并另行检验是否完整。

本脚本没有网络登录能力，避免为探针给优化者开放不受限网络。Linux 启动通过但
尚未实测账号登录时，P0 第二问答案是“启动可行，认证仍待账号及出口配置验证”，
不得据此宣布优化者隔离方案已全部验证。若实际登录最终不通，评估专用系统用户
备选。厂商域名放行属于后续认证实测前置；不能用默认 bridge 全放行替代。

## 8. 汇总五个 P0 问题和清理

在 Claude 的实测报告逐条回答，引用存档报告路径，未知项明确写“未验证”：

| 问题 | 证据与判定 |
| --- | --- |
| 8GB 并发 2 稳定吗 | mock/real 分别列重复次数、通过数、OOM、VM/容器峰值、宿主压力；不足时降到 1 |
| 优化者如何登录 | Linux CLI 版本/启动结果；API Responses 代理需求；订阅认证是否实际完成、出口白名单与会话统计需求 |
| 能否访问宿主回环 | 哨兵活跃证据、每个地址/网关的逐项结果；4173 服务未启动必须备注 |
| OpenCode 是否全部经代理、token 对上吗 | internal 网络证据、usage 请求数/完整性、DB 五项 token、delta；不能仅看模型回答成功 |
| 构建多久、依赖如何限制联网 | 首次/缓存构建分开列，镜像大小；运行期无公网启动结果；必要时考虑容器内源码运行 |

probe `pass` 仅为一次 OpenCode 闭环通过，不包括尚未执行的 Codex 认证。
若未提供 real 凭证，真实耗时、真实资源稳定性仍未验证。

```bash
rm -- "$RSI_HOST_CANARY"
unset RSI_UPSTREAM_API_KEY
bash scripts/rsi-probe/colima-stop.sh
```

终端 A 用 Ctrl-C 关闭哨兵。镜像可保留供复测，VM 停止即可；不自动删除 VM。
提交由 Claude 审查后完成，建议信息：`M13: rsi — 增加本地隔离 P0 探针`。
