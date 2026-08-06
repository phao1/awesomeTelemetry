## Context

See `proposal.md` for motivation. Trae's SQLCipher scan already decrypts and reads `server_history_info`, `history_v2`, `chat_session`, and `chat_turn` in a background polling path. The current parser strips `<system-reminder>` content to keep only user intent, while `chat_turn.context` is read only for agent metadata. Ordinary list/detail paths have strict response-size budgets and cannot absorb this text.

The observed Trae schema stores the complete dynamic user envelope in `server_history_info.messages` and model/runtime metadata under `chat_turn.context.persist_user_message_context.model_info`. It does not store the static server template or complete tool definitions, so database evidence is necessarily partial.

## Goals / Non-Goals

**Goals:**

- Preserve the latest dynamic reminder envelope per native Trae session during the existing background decrypt scan.
- Provide a truthful, on-demand analysis surface with provenance, completeness and deterministic metrics.
- Keep secrets and broad runtime configuration out of the derived cache and API.
- Preserve list/slim-detail budgets and the no-decryption-on-request-path rule.

**Non-Goals:**

- Capturing or reconstructing Trae's static server template and complete tools array.
- Running Frida, LLDB, or any child process from an HTTP request.
- Generalizing extraction to all providers in this phase; the API/data model is provider-neutral so later adapters can opt in.

## Decisions

### D1: Separate Prompt Context from `sessions.system_prompt`

Use a one-to-one `session_prompt_context` table containing JSON-encoded sections, model config and analysis. `sessions.system_prompt` retains its existing meaning: a complete prompt associated from proxy capture. This prevents partial Trae database context from setting `hasSystemPrompt = true` or being mistaken for a complete prompt.

Alternative rejected: write dynamic reminders into `sessions.system_prompt`. It is smaller to implement but semantically false and leaks the body through an existing detail field.

### D2: Latest-envelope snapshot, not per-turn history

For each native session, retain the most recent user envelope containing at least one `<system-reminder>` and pair it with the most recent `chat_turn.context`. This gives the user the current effective dynamic context without multiplying storage by every turn.

Alternative rejected: persist every turn. It increases DB size and requires pagination/versioned UI before the first useful display.

### D3: Parse and desensitize in the background scanner

Section parsing, duplicate analysis and default-rule desensitization happen after SQLCipher decryption and before AwesomeTelemetry persistence. The HTTP route performs one indexed lookup and JSON decode only. Whitelisted model fields are copied; nested auth/base URL/raw config values are never persisted.

Alternative rejected: persist raw envelopes and redact on response. Raw secrets would remain in the derived database and response-time redaction would add latency and failure modes.

### D4: On-demand endpoint and modal

`GET /api/sessions/:key/prompt-context` is separate from both the session list and slim/full session detail. The toolbar button opens a modal that performs one request, implements four states, and states completeness before showing bodies.

Alternative rejected: include Prompt Context in `mode=full`. That endpoint already risks large bodies and does not represent the explicit UI action narrowly enough.

### D5: Additive schema v5 migration

Create `session_prompt_context` with a `session_id` primary/foreign key and JSON text columns. Existing databases migrate non-destructively; rollback can leave the unused table in place because older binaries ignore it.

## Risks / Trade-offs

- [Trae changes JSON keys or reminder markup] → Extraction is capability-detected; ordinary session parsing continues and no Prompt Context row is written.
- [Latest turn metadata and latest user envelope are not the same turn] → Capture times remain explicit; later work can add turn-id linkage when the vendor schema exposes a stable join.
- [Default desensitization has false positives] → The modal labels content as desensitized; correctness and local-secret safety take priority over byte-perfect reproduction.
- [Dynamic context can still be large] → One row per session, one explicit request, gzip support, and no inclusion in list/slim detail constrain the cost.

## Migration Plan

1. Upgrade schema metadata to v5 and create the new table/index through idempotent initialization.
2. On the next changed/forced Trae background scan, derive and upsert Prompt Context after authoritative session records are stored.
3. Deploy the API and UI; sessions without a v5 scan show the documented empty state until rescanned.
4. Rollback by running the previous binary; the additive table remains unused and session/event data is unaffected.
