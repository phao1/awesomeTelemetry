# Remote branch handoff — 2026-10-20

用户要求停止后续功能开发，换电脑/代理继续，并把当前代码提交到远端分支。
本提交仅保存已有功能增量、提交前验证结果和本说明；不会启动下一批开发。
长期目标保持 paused，尚未完成。功能验收前不推进可靠性/长稳/数据库拆分。

## 新电脑启动

```sh
git clone --branch codex/telemetryref-npm-continuation --single-branch https://github.com/phao1/awesomeTelemetry.git
cd awesomeTelemetry
```

先读完整 AGENTS.md、BOOTSTRAP.md 和本文件，再安装符合 package.json engines
的 Node.js（当前 >=20.19.0），执行 `npm ci`。重新运行 typecheck/test/lint/build；
旧电脑日志只代表旧环境结果。本分支不包含 node_modules、运行服务、本机数据库、
用户配置、密钥或抓包原文。不要寻找旧电脑的绝对路径、PID 或4188/5188服务。
如需页面验收，先检查 demo 脚本，创建新的隔离临时 fixture 并关闭真实 providers；
不要直接启动真实记录扫描、配置真实 Agent 或重复执行旧的未知结果下载。

## 当前权威进度

- M12 npm 基线上补 M11 融合功能。完整总账见 npm-continuation.md：
  76项中41关闭、33部分完成、2未实现。不能把此数字当功能成熟度或工作量百分比。
- 旧 tasks.md 的30/71已过时。按最新总账、对应契约和源码重新逐项核对。
- 最新 official-hooks-feature.md 记录 Claude 官方 HTTP hooks 接收、显式配置片段、
  schema21元数据、原文存储/校验、精确工具范围查询、共享SSE和页面入口。
  默认关闭；生成片段后由用户手工合并；不修改 Agent 配置。实际 Claude 版本调用
  仍未认证，不能把合成HTTP测试当真实Agent或权限/派生证明。
- 前序实现包括 Frida保存/详情/通知、CDP开发入口、OTLP元数据导出、受控实验记录、
  原生工具调查/会话家族、选中请求原始证据tar包等；见对应 *-feature.md 与
  functional-rollout-2.md / functional-rollout-3.md。
- 功能增量最后完整回归：307文件、3724测试通过/1既有跳过；类型/lint/build/
  package/OpenSpec通过。此次提交前复验及性能门禁另记 PERF-BASELINE.md。

## 后续范围

仍需按总账补齐完整原生来源会话归档/collector互通、调用/重试/跨来源计费同一性
剩余条款、其他官方hook/插件、实际Windows目标hook、安全真实重放和优化质量实验。
真实平台、浏览器下载保存结果、长稳等证据不能从合成测试或静态文档推断。
Hook崩溃恢复、长稳、物理磁盘故障、数据库拆分等留待用户功能验收后。

## 给下一位代理的提示词

> 接手本分支 awesomeTelemetry 的剩余功能开发。先完整读取 AGENTS.md、
> BOOTSTRAP.md、本 remote-handoff.md、npm-continuation.md 和最新 feature 记录。
> 重新核对当前源码和契约，完成所有尚未完成的功能；可靠性、长稳和数据库拆分
> 等我验收功能后再做。不要缩减目标或把已做部分说成全部完成。开始前读完整模块
> spec/gotchas、列清精确文件白名单；字段、表、路由以权威契约为准。不增加运行时
> 依赖，不放宽测试，不丢掉已有改动。新电脑先安装依赖并重新验证，必要时用隔离
> 合成环境验收；不依赖旧电脑路径、服务、数据库或聊天。涉及真实模型费用、工具
> 副作用、真实用户配置或请求重放时，先准备具体可审查方案并核对授权。所有commit
> 信息用英文；未经要求不提交、推送或发布。请直接核查并推进，不只返回计划。
