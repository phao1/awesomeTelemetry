# Spec: Adapters

> 9 provider adapters: raw data → normalized TraceRecord. Source files:
> `src/adapters/`

## Purpose

Each provider's raw data format differs; adapters normalize it into
`TraceRecord`.

## Requirements

### REQ-001: sample-loader dispatch
`sample-loader.ts` SHALL dispatch by `sourceAgent` to the matching adapter.
Adding a provider = add adapter + register + update `PROVIDER_KEYS` + both i18n
locales.

### REQ-002: token semantics must be declared
Every adapter MUST return `TokenSemantics`. This is a compile-time enforced
field, not a convention.

| Provider | cacheRead | reasoning |
|----------|-----------|-----------|
| claude / codeagent | incremental | incremental |
| codex | incremental | incremental |
| opencode / codearts / codeagent2 | **incremental** | incremental |
| trae | incremental | incremental |
| qoder / workbuddy | incremental | incremental |

### REQ-003: Body truncation and separation
Adapters MUST split every event into three parts: slim fields (title <= 200
chars), `inputSummary` / `outputSummary`, and `raw`. `raw` MUST be returned
separately and written by storage into the `event_raw` table.

### REQ-004: Claude Code adapter
`claude-code.ts` SHALL convert Claude JSONL into TraceRecord. `codeagent.ts`
wraps it: drop `file-history-snapshot` rows, relabel actor.

### REQ-005: OpenCode adapter (reused)
`opencode.ts` SHALL handle three sources — SQLite DB rows (part table joined
with message table) / JSONL / OTel spans — and use the `OpenCodeDialect` param
to distinguish CodeArts / CodeAgent2 / OpenCode. The latter two are thin
wrappers.

#### Scenario: subagent detection
- **GIVEN** a session title matching `/\(@.*\bsubagent\)/i`
- **THEN** `session.isSubagent = true`

#### Scenario: cacheRead incremental (calibrated 2026-08-03)
- **GIVEN** an OpenCode session with 3 events whose `cacheRead` values are
  6016/4000/2000
- **WHEN** computing session-level tokenUsage
- **THEN** `cacheRead` takes the sum (12016), not max
- **AND** `total = input + output + reasoning + cacheRead + cacheWrite`

> #6 was settled with real data (2026-08-04):
> - OpenCode `ses_0fdca2dc`: tokens.total = input+output+reasoning+cache,
>   output excludes reasoning → `reasoningInTotal: true`
> - CodeArts/DeepSeek `ses_1afaab585ffe`: tokens.total = input+output+cache
>   (no reasoning), reasoning is a subset of output →
>   `reasoningInTotal: false`, avoiding double counting
> Adapters MUST declare their provider's accounting via
> `TokenSemantics.reasoningInTotal`.

### REQ-006: Trae adapter
`trae.ts` SHALL convert TraeRecord into TraceRecord:
- turn status mapping: completed→success, paused→running, canceled→cancelled
- inline phase mapping: read_file→understand, write_file→implement,
  reasoning→plan, bash→implement (verify when the test regex matches)
- **`token_usage` is the real total (calibrated 2026-08-03)**:
  `output = item_token_usage`, `input = token_usage - item_token_usage`;
  when item_token_usage is missing, `output = token_usage`, input = 0
- non-LLM rows' numeric `token_usage` is message size, MUST skip; only rows
  with `content_source === 'llm_default'` count into outputTokens
- second-level timestamps MUST be ×1000
- **#7 multi-table enhancement**: chat_session provides
  title/agent_type/agent_name; history_v2.messages JSON provides a
  reasoning_content fallback (shown when llm rows have no body);
  chat_message_task provides tool name/params/result; all guarded by
  table/column existence and degrade to single-table server_history_info
  behavior when missing

### REQ-007: Codex adapter
`codex.ts` SHALL convert Codex JSONL into TraceRecord:
`function_call`→tool/implement, `function_call_output`→tool/implement,
`user`→user_prompt, `assistant`→llm.

### REQ-008: Qoder adapter
`qoder.ts` SHALL convert Qoder JSONL into TraceRecord, calling
`classifyEvents`; `durationMs` computed from adjacent timestamps.

### REQ-009: WorkBuddy adapter
`workbuddy.ts` SHALL:
- pair `function_call` with `function_call_result` by `callId` (note:
  `function_call` ≠ `tool_use`)
- extract the user question from `<user_query>` tags
- detect kind by tool name: Bash/PowerShell→bash, Read/Glob/Grep→file_read,
  Write/Edit→file_write, Agent→subagent_prompt, Skill→agent
- detect errors: `Exit Code: [1-9]` regex + the `skipRun` flag
- accumulate cost from `rawUsage.credit`

### REQ-010: Status normalization table
| Native value | TraceStatus |
|--------------|-------------|
| completed / done / finished / ok | success |
| failed / error / exception | error |
| running / in_progress / paused / pending | running |
| canceled / cancelled / aborted / interrupted | cancelled |
| anything else | unknown |

### REQ-011: normalizeRawSample
`normalizeRawSample(rawSample)` SHALL convert a `sourceAgent`-carrying
RawSample into TraceRecord for scan-scheduler.

### REQ-012: required per-adapter tests
Every adapter MUST have a colocated `*.test.ts` covering at least:
1. a full TraceRecord snapshot of one minimal fixture
2. token aggregation semantics (especially the OpenCode-family max vs sum)
3. the four-class status normalization mapping
4. the `:sequence` suffix for duplicate event ids
5. slim-field title truncation

### REQ-013: duration derivation & model attribution (add-mission-control)
Adapters whose source data does not carry real event durations MUST run
`deriveDurations()` (`src/adapters/helpers.ts`) and label the session
`durationSource: 'derived'`; sources with real span durations keep
`durationSource: 'measured'`. The choice MUST follow the actual parse path
(e.g. opencode db/jsonl vs otel), NEVER a per-provider hardcode.

Every adapter MUST populate `TraceEventSlim.model` for llm events when the
source carries a model id (`claude-code.ts` reads `message.model`;
opencode/trae/codex/workbuddy read their own fields), and MUST leave it
`null` when the source has none — never guess. Sessions get
`primaryModel` from `pickPrimaryModel(events)` (highest token share).

`duration_source` / `primary_model` / `cost_source` produced by adapters MUST
be persisted by the storage layer on the next scan (writers + query-engine),
never dropped.

#### Scenario: claude fixture model attribution
- **GIVEN** a claude fixture whose llm messages carry `model`
- **WHEN** the adapter parses it
- **THEN** llm events have `model` set and the session has a non-null
  `primaryModel`

#### Scenario: provider without model data
- **GIVEN** a provider whose source rows have no model field
- **THEN** llm events get `model: null` and `primaryModel: null`
- **AND** the pipeline must not throw or fabricate a model

## Gotchas
- G4.4: cacheRead incremental uses sum (2026-08-03 calibration overturns the
  max assumption)
- G4.2: Trae `token_usage` is the real total; input =
  token_usage - item_token_usage
- G4.3: Trae non-LLM rows' token_usage is message size; do not double count
- G4.6: total duration uses wall-clock
- G9.1: CodeArts / CodeAgent2 reuse opencode (dialect param); implement
  opencode first, then a 2-line wrapper
- G9.2: CodeAgent 3.0 wraps claude-code (drops file-history-snapshot)
- G9.3: OpenCode subagent title regex detection
- G11.10 (new): adapters must return raw and body separately; mixed together,
  storage cannot do the three-tier split
