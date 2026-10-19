## Why

开发者需要在完成首次接入后，点击开启监控，就能在本地 Web 中追踪 Agent 的模型请求、工具执行、上下文变化与错误，并用可信证据优化成本、性能和适配。现有项目具备扫描、存储、分析和 UI 基础，但实时采集到 Trace 的闭环尚未接通；telemetryRef 提供协议解析与评测思路，却不能直接作为可信生产采集链路照搬。

## What Changes

- 以 awesomeTelemetry 为产品主体，选择性重写/吸收 telemetryRef 的协议语义、字段提取与测试场景，不合并两个运行栈，不引入 Python/LiteLLM 必选依赖。
- R1 完成端到端闭环：接入向导 → 开启监控 → HTTP/HTTPS/SSE 采集 → 安全规范化 → 与本地会话关联 → Web 实时 Trace/上下文 diff/证据化诊断。
- 按协议而非厂商域名主导解析：OpenAI Chat Completions、Responses、Anthropic Messages；自定义网关同等测试。
- 明确监控运行、Agent 会话、用户轮次、模型调用/重试、工具执行的不同身份，保留来源及关联依据；缺失数据不伪造。
- 补齐单一 CA、生命周期竞态、流式解码、取消/异常、原文完整性、增量推送、容量限制与可靠指标。
- **BREAKING（用户已批准）**：监控不脱敏，原样保存 headers/body/prompt/tools；原文独立流式存储，默认总预算10GB、单方向100MiB，均可配置；满额报警并停止新增正文，禁止自动删除旧证据。协议优先解析，新增关联 Trace 并保留原始视图。
- R2 扩展经过真机验证的 Agent/OS 组合、可选 native hook/CDP/Frida；R3 再做标准导出和受控评测。不把 R2/R3 当 R1 已交付。

## Capabilities

### New Capabilities

- `agent-monitoring`: 接入能力矩阵、监控生命周期、跨来源身份关联、证据链与开发者优化工作流。

### Modified Capabilities

- `proxy-capture`: 单一 CA、协议优先解析、完整流式语义、失败与背压处理。
- `desensitization`: 监控路径旁路脱敏，原文直接展示/导出，legacy 工具仅保留兼容。
- `trace-model`: 修正与权威契约矛盾的 token 描述，新增来源/关联/完整性语义。
- `metrics-analysis`: 区分代理观测、原生测量与推导指标，防止重复计费与误判。
- `storage`: 独立原文文件、明确容量约束、证据可重算和失败恢复；禁止隐式过期或淘汰原文。
- `realtime`: 真正接通安全流式事件、增量列表和断线恢复。
- `frontend`: 保留原始视图，新增关联探索、接入诊断、指标依据与完整性展示。

## Impact

涉及 `openspec/contracts/{data-model,database,api,nfr}.md`、上述模块 specs、`server/proxy/`、`server/desensitization/`、`server/storage/`、`server/realtime/`、HTTP/CLI、`src/core/`、`src/components/` 与已有 scanner/adapter 接口。准确文件白名单由每个开发批次开始前列出；本次仅创建本 change 内规划文件。

依赖维持现有批准范围；不新增运行时依赖，不默认安装证书、不修改系统代理、不改变模型请求内容、不自动重放付费调用或工具操作。telemetryRef 未发现仓库级许可证，直接移植代码前须确认来源与复用授权；本提案不做法律判断。

用户已批准开发及必要契约扩展，无需逐字段重新审批。基线与文件清单见 baseline.md；最新决定见 implementation.md。parity.md 是 telemetryRef 能力对等验收表，未验证项目不能宣称完成。
