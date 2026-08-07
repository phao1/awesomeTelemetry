## Why

AwesomeTelemetry can already capture and display complete proxy requests, but a developer must manually compare large JSON bodies to answer the most important forensic question: **what context changed between two model calls, and could that change explain the agent's behavior?** claude-tap makes this workflow immediate through structured adjacent-request diff across prompts, messages, tools, and parameters; its current public documentation presents this as a core debugging advantage.

Phase 1 closes that specific gap without turning AwesomeTelemetry into a second generic packet viewer. It adds evidence-grade request-context diff on top of the existing local MITM store, then connects the result to AwesomeTelemetry's longer-term session analysis. This is the smallest product slice that materially improves one-run debugging while preserving the project's local-first, multi-agent, and performance constraints.

## What Changes

- Add a provider-neutral request-context normalization contract for captured Anthropic Messages, OpenAI Chat/Responses, and compatible gateway payloads.
- Assign each newly started proxy runtime a stable capture-group identifier so adjacent requests can be paired without pretending unrelated historical traffic belongs to one session.
- Add deterministic pairing rules with explicit `exact`, `capture_group`, `manual`, and `unavailable` confidence; automatic pairing never silently crosses a known session or capture-group boundary.
- Add a server-side context-diff endpoint that compares one request with its eligible predecessor or an explicitly selected request.
- Diff system prompt, conversation messages, tool definitions/schemas, model/request parameters, token/context growth, and compaction/truncation signals.
- Return bounded, desensitized evidence with source request IDs, hashes, completeness flags, and truncation reasons; raw bodies remain available only through the existing explicit request-detail path.
- Add a `Context Diff` tab to the existing Proxy detail drawer with summary, category navigation, inline changes, pairing confidence, evidence links, and complete loading/empty/error states.
- Add focused unit, API-contract, performance, and frontend tests, plus real local capture acceptance for at least Anthropic Messages and OpenAI Responses traffic.
- No breaking API removal or runtime dependency is introduced.

## Capabilities

### New Capabilities

- `request-context-diff`: Defines request normalization, pairing, semantic diff categories, evidence/provenance, bounded responses, confidence, and failure behavior.

### Modified Capabilities

- `proxy-capture`: Captured requests gain a proxy-run correlation identifier and parser output sufficient for deterministic context normalization.
- `storage`: Adds non-destructive persistence and indexed lookup for capture-group adjacency while preserving body exclusion from list queries.
- `frontend`: Extends the Proxy request drawer with an on-demand Context Diff workflow and evidence-first states.

## Impact

- **Contracts:** additive changes to `openspec/contracts/data-model.md`, `database.md`, `api.md`, and `nfr.md`; schema version advances through a non-destructive migration.
- **Backend:** proxy runtime/writer, parser normalization, storage query engine, a dedicated context-normalization/diff module, and one additive HTTP route.
- **Frontend:** API client, Proxy drawer, diff presentation components, bilingual strings, styles, and colocated tests.
- **Security/privacy:** only already-desensitized request bodies participate in diff; raw request bodies and auth headers MUST NOT enter the diff response, logs, snapshots, or test fixtures.
- **Performance:** diff is on demand, compares exactly two requests, applies explicit input/output caps, and MUST NOT alter proxy forwarding latency or session-list/detail payloads.
- **Dependencies:** no new runtime dependency; use Node/TypeScript standard library and existing UI atoms.
- **Source evidence:** claude-tap README and local trace viewer guide, reviewed 2026-08-07: https://github.com/liaohch3/claude-tap and https://github.com/liaohch3/claude-tap/blob/main/docs/guides/agent-trace-viewer.md
