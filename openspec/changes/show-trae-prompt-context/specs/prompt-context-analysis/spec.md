## Purpose

让用户按会话检查 AI 编码助手实际持久化的动态 Prompt 上下文、模型运行配置与可解释统计，同时用来源和完整性标识防止把部分上下文误认为完整 System Prompt。

## ADDED Requirements

### Requirement: Prompt Context contract and provenance

The system SHALL represent prompt context independently from `TraceSession.systemPrompt`. Each response SHALL include the owning session id, provider, source, capture time, completeness, dynamic sections, whitelisted model configuration, analysis metrics, and `fullSystemPrompt`.

Database-derived Trae records SHALL use `source = 'trae_db'`, `completeness = 'dynamic_only'`, and `fullSystemPrompt = null`. The system MUST NOT reconstruct or label a complete static System Prompt from dynamic reminders or runtime metadata.

#### Scenario: Database-only Trae context

- **WHEN** a Trae session contains dynamic reminders and model metadata in its decrypted database
- **THEN** the Prompt Context response identifies the source as `trae_db` and completeness as `dynamic_only`
- **AND** `fullSystemPrompt` is `null`

### Requirement: Dynamic section analysis

The system SHALL split the latest persisted user-message envelope into ordered `<system-reminder>` sections. Each section SHALL include a stable id, category, display title, desensitized content, character count, estimated token count, and an optional duplicate reference.

The analysis SHALL report total characters, estimated tokens using `ceil(chars / 4)`, section count, unique section count, duplicate section count, duplicate character count, and context-window percentage when a positive prompt-token limit is known.

#### Scenario: Repeated reminder injection

- **WHEN** two normalized reminder sections have identical content
- **THEN** the later section references the first section as its duplicate
- **AND** duplicate section and character counts include the later section

#### Scenario: Known context window

- **WHEN** the dynamic context contains 4,000 characters and the model configuration declares a 100,000-token prompt limit
- **THEN** estimated tokens equal 1,000
- **AND** context-window percentage equals 1

### Requirement: Sensitive content handling

Prompt Context section bodies SHALL pass through the default desensitization rules before persistence. Runtime model metadata SHALL be selected from an explicit allowlist and MUST NOT expose authentication values, base URLs, request headers, or raw configuration objects.

#### Scenario: Secret and local path in reminder

- **WHEN** a reminder contains an API key and a local user path
- **THEN** the persisted section masks both values using the configured default rules
- **AND** the API never returns the original values

### Requirement: On-demand session endpoint

`GET /api/sessions/:key/prompt-context` SHALL return one `SessionPromptContext` for the requested stored session. The endpoint SHALL return `404 SESSION_NOT_FOUND` when the session does not exist and `404 PROMPT_CONTEXT_NOT_FOUND` when the session exists but has no captured context.

Session list and ordinary session-detail responses MUST NOT include Prompt Context section bodies or model configuration. The frontend SHALL call this endpoint only after an explicit user action.

#### Scenario: Explicit detail request

- **WHEN** the user opens Prompt Context for a captured Trae session
- **THEN** exactly one Prompt Context request is issued for that action
- **AND** the response includes dynamic sections and analysis

#### Scenario: Ordinary detail remains slim

- **WHEN** a client requests the session list or `GET /api/sessions/:key`
- **THEN** neither response contains Prompt Context section bodies

