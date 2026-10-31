# 深度健康监测（P4）

先生成普通报告，再点击“深度监测”。预览显示脱敏后的证据包、字节数、模型和近似 token 估计；展开证据检查后，点击“确认并调用模型”。取消预览不会调用模型。估计按包 UTF-8 字节数除以 3 向上取整，不代表账单或价格；输出上限为 4096 token。

服务器只读取以下四个环境变量。以下值均为占位符，不包含可用配置；模型 ID 必须显式填写，没有默认模型。环境变量应通过自己的安全方式注入服务进程，切勿保存真实密钥到仓库。

Anthropic（BASE_URL 为 Messages API 的父路径）：

```sh
HEALTH_MODEL_PROVIDER=anthropic
HEALTH_MODEL=<your-anthropic-model-id>
HEALTH_MODEL_BASE_URL=https://<your-anthropic-endpoint>/v1
HEALTH_MODEL_API_KEY=<your-api-key>
```

Anthropic 未设置 BASE_URL 时使用官方 `/v1/messages` 地址。openai-compatible 必须提供 BASE_URL（客户端追加 `/chat/completions`）：

```sh
HEALTH_MODEL_PROVIDER=openai-compatible
HEALTH_MODEL=<your-compatible-model-id>
HEALTH_MODEL_BASE_URL=https://<your-compatible-endpoint>/v1
HEALTH_MODEL_API_KEY=<your-api-key>
```

`GET /api/task-health/model-status` 只返回 configured、provider、model。缺少模型、提供方或密钥，以及无效 URL，均视为未配置；deep 返回 `HEALTH_MODEL_UNAVAILABLE`。配置通过服务进程环境生效，界面不接收密钥或自定义 URL。

证据包最多 48KiB，包含普通报告事实、最多 150 轮、按精确 recordId 读取的发现摘录、同量的相邻正常样本（不足时标注）、任务目标、最后助手回复和最后验证输出尾部。正文定点读取限制 64KiB；目标限制 2000 字，其他摘录限制 1500 字。未保留/无法取得的正文或真实尾部明确标注缺失；不假装完整。在摘录截断前先脱敏正文，超长不透明 token 也保守移除；所有可读文字经过脱敏，脱敏超预算则整包失败。导出的深度报告不包含证据包正文。

确认请求只发送预览 digest。服务器重建证据包、核对当前 revision 和 digest；变化后须重新预览，禁止自动重试。单个服务器只允许一个普通/预览/深度分析，无等待队列。预览期限 45 秒，模型调用单次、120 秒、可取消、无重试，模型不获工具。界面等待上限为预览 50 秒 / 深度 125 秒。取消或断连可能发生在保存之后，可手动刷新历史确认，勿自动重复提交。

深度报告与普通报告分 tab 展示，具有独立 UUID 和文件，关联普通报告 ID；永不改写普通报告。合法 JSON 结构不合规则保存 rejected；外来证据引用丢弃，事实表以外的数字（含数字词和显式单位换算）降为未采纳，其他条目可保留为 partial。数字校验保守，无法确认的数词表达可能被排除；应使用事实表原值或明确换算，未知时写“无法判断”。被采纳报告标 model_judged，并单列拒绝原因。非 JSON 返回 `HEALTH_MODEL_FAILED`；超时、取消、传输错误及超限不新增报告。诊断 token 与耗时单独显示，不计入任务指标。

普通与深度报告合计每任务最多 50 份，不自动删除。历史只在打开抽屉或手动刷新时读取，源 revision 改变后标为过期。支持 HTML、Markdown、原始已保存 JSON 下载。

证据包按脱敏后的 UTF-8 序列化体积逐级精简：事实表只保留非 null 指标的 key/value/unit/timing/layer/stat/facets/samples；null 指标只在 limitations 的一行列出 key，不携带原始样本列表或指标证据链。发现保留 id（用于 necessity.findingId 校验）、rule/dimension/facts 和最多 5 个 evidenceIds。公共 evidence 只保留这些引用的有界定位信息，不再重复摘要正文。

超过 48KiB 时，轮摘要依次从 150 降至 60、30，优先保留首尾及发现所引用的轮；正常样本先减到发现数量，再减到 1；非目标摘录依次从 1500 缩至 800、400 字。每步写入 limitations。最后才退到最小包：目标、精简事实表和每条发现的一份 400 字摘录，省略轮摘要、正常样本、最终回复和验证尾部并明确记录。只有最小包仍超过 48KiB，才报 `HEALTH_SIZE_LIMIT`。缺失正文继续显式标记，不伪造证据。数字校验只允许包内可见的精简事实值及明确单位换算，不允许引用被省略的原始 samples/values 数值。

界面按错误码说明证据包无法再精简、模型未配置、模型请求失败、超时或证据变化。digest 不一致时必须重新预览，不会自动重复调用模型。

## 用本机 Codex 作为深度监测模型

先完成本机 Codex 登录，再在终端执行以下两步。代理使用 Codex 的登录与额度，不读取 Codex 凭据文件；模型无工具，只在临时空目录的只读沙箱运行。代理仅监听 127.0.0.1，要求 Bearer token，单并发，无队列；客户端断开时终止 Codex。

1. 生成 token 并启动代理（保留当前终端，通过自己的安全方式将同一 token 传给服务终端）：

```sh
export PROXY_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run health-proxy:codex
```

2. 在另一个终端用同一 token 启动服务（以下占位符需替换）：

```sh
HEALTH_MODEL_PROVIDER=openai-compatible \
HEALTH_MODEL='your-codex-model-id' \
HEALTH_MODEL_BASE_URL=http://127.0.0.1:4317/v1 \
HEALTH_MODEL_API_KEY='same-PROXY_TOKEN' \
npm start -- web
```

`CODEX_BIN` 可指定 Codex 可执行文件路径；未设置时先找 PATH，再尝试 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`，均不可用则启动失败。`CODEX_EFFORT` 默认 `medium`；`PROXY_PORT` 默认 `4317`。真实任务单次约 40–50 秒，耗时随模型和任务变化。Codex 自带约 9–10k token 系统提示，因此实际输入 token ≈ 预览估计 + 约 10k。

默认仅通过内存传递提示词、JSONL 事件和回复，临时空目录在结束后删除。可选 `PROXY_REPLY_DIR` 指向已存在的诊断目录；启用后会落盘模型原文（去围栏前），可能包含证据摘录，请按敏感资料管理。代理不保存其他提示词或回复文件。

提示词版本 2 要求正文使用阿拉伯数字，原样复制事实值并带单位，或仅写 ms → s/min/h 的换算结果；不写换算系数、中文数词/量词短语、计数、序号或 ID 中的数字。证据通过 evidenceIds 引用，无事实值时写“无法判断”。校验兼容明确的除法系数说明，拒绝项附首个未接受 token 及脱敏后最多 160 字的首个文本字段，旧报告缺少这些字段仍可读取。
