## Why

Trae 的 SQLCipher 数据库已经包含每轮请求的动态 `<system-reminder>` 上下文和模型运行配置，但当前扫描会在提取用户意图时丢弃这些信息，UI 只能显示 `systemPrompt: null`。需要把可验证的动态上下文按会话保存并按需展示，同时明确它不是完整的静态 System Prompt，避免误导用户。

## What Changes

- 从每个 Trae 原生会话的用户消息与 `chat_turn.context` 中提取动态 Prompt 上下文、模型配置和可解释统计。
- 新增独立的会话 Prompt Context 存储与按需读取 API；会话列表和普通详情不携带大文本。
- 在会话头增加 Prompt 上下文入口，展示来源、完整性、模型配置、分区内容、重复注入与上下文窗口占用分析。
- 对展示内容应用保守的敏感信息遮罩，并明确标注“仅动态上下文”；完整静态 System Prompt 保持不可用状态，不从数据库内容伪造。
- 为既有数据库增加非破坏性 schema v5 迁移，并在会话删除时级联清理 Prompt Context。

## Capabilities

### New Capabilities

- `prompt-context-analysis`: 定义 Prompt Context 数据模型、分析口径、按需 API、来源/完整性标识和敏感信息处理。

### Modified Capabilities

- `trae-decryption`: SQLCipher 扫描在会话边界内保留可验证的动态 Prompt 上下文与 `chat_turn` 模型配置。
- `storage`: 增加 Prompt Context 的幂等持久化、查询和删除行为。
- `frontend`: 会话详情增加按需加载的 Prompt Context 分析入口与四态展示。

## Impact

- 数据合同：`openspec/contracts/data-model.md`、`database.md`、`api.md`。
- 后端：Trae SQLCipher 读取器、扫描落库、schema/writer/query、HTTP 路由。
- 前端：API client、会话头、Prompt Context 模态框、i18n 与样式。
- 不新增运行时依赖；不改变现有会话列表或 slim detail 的响应体积。
- 本阶段不实现 macOS/Windows 内存中的完整静态 System Prompt 捕获。
