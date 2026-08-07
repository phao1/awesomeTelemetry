## Purpose

Provide evidence-grade, provider-neutral comparison of the context sent in two captured model requests so agent developers can identify prompt, history, tool, parameter, and context-growth changes without manually diffing raw JSON.

## ADDED Requirements

### Requirement: Supported request normalization
The system SHALL normalize desensitized request bodies from Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses into one provider-neutral context snapshot. The snapshot SHALL distinguish system/developer instructions, conversation messages, tool definitions, model parameters, and source metadata. The system SHALL NOT infer missing sections or label an unknown request shape as a supported format.

#### Scenario: Anthropic Messages request
- **WHEN** a captured request contains a valid Anthropic Messages payload with `system`, `messages`, `tools`, and model parameters
- **THEN** the normalized snapshot contains those four categories with their order and source paths preserved
- **AND** the snapshot format is `anthropic_messages`

#### Scenario: OpenAI Chat Completions request
- **WHEN** a captured request contains a valid OpenAI Chat Completions payload with system/developer messages, conversation messages, tools, and model parameters
- **THEN** system/developer messages are separated from conversation history without changing their order
- **AND** the snapshot format is `openai_chat`

#### Scenario: OpenAI Responses request
- **WHEN** a captured request contains a valid OpenAI Responses payload with `instructions`, `input`, `tools`, and model parameters
- **THEN** the normalized snapshot maps those values into the provider-neutral categories
- **AND** the snapshot format is `openai_responses`

#### Scenario: Unknown or malformed body
- **WHEN** a request body is absent, not valid JSON, encrypted, or does not match a supported request shape
- **THEN** normalization returns an unavailable result with a stable reason
- **AND** the system SHALL NOT fabricate an empty successful snapshot

### Requirement: Safe evidence source
Context normalization and diff SHALL use only the stored desensitized request body. Raw request bodies, raw response bodies, authorization headers, cookies, credentials, and private keys SHALL NOT be read by the diff workflow or returned in its response.

#### Scenario: Raw retention is enabled
- **WHEN** `keepRawBodies` is enabled and a proxy row contains both desensitized and raw request bodies
- **THEN** the diff result is derived exclusively from the desensitized request body
- **AND** no raw-only secret appears in the result, logs, errors, snapshots, or test output

#### Scenario: Desensitized body is absent
- **WHEN** only a raw request body exists or the desensitized request body is null
- **THEN** context diff is unavailable with reason `desensitized_body_missing`
- **AND** the raw body SHALL NOT be used as fallback

### Requirement: Deterministic automatic pairing
For a target request, the system SHALL select at most one earlier automatic base request using the following precedence: first, the nearest earlier supported request with the same non-empty parsed session identifier and endpoint family; second, the nearest earlier supported request in the same non-empty capture group with the same endpoint family and model. The system SHALL NOT automatically pair across a conflicting known session identifier or capture-group boundary.

#### Scenario: Exact session predecessor exists
- **WHEN** the target has a parsed session identifier and an earlier supported request has the same identifier and endpoint family
- **THEN** the nearest such request is selected
- **AND** pairing confidence is `exact`

#### Scenario: Capture-group predecessor exists
- **WHEN** no exact-session predecessor exists and an earlier supported request has the same capture group, endpoint family, and model
- **THEN** the nearest such request is selected
- **AND** pairing confidence is `capture_group`

#### Scenario: Conflicting known sessions
- **WHEN** two requests share a capture group but both have non-empty and different parsed session identifiers
- **THEN** they SHALL NOT be automatically paired

#### Scenario: No trustworthy predecessor
- **WHEN** neither exact-session nor capture-group pairing is available
- **THEN** the result reports `pairing_unavailable`
- **AND** no diff is computed until the user explicitly selects a base request

### Requirement: Explicit manual pairing
The user SHALL be able to compare the target with another existing supported proxy request by ID. Manual pairing SHALL preserve the submitted base and target order, SHALL be labelled `manual`, and SHALL disclose session, capture-group, endpoint-family, and model mismatches rather than rejecting them silently.

#### Scenario: Valid manual pair
- **WHEN** the user requests a diff with two distinct supported request IDs
- **THEN** the system compares them in the requested base-to-target order
- **AND** pairing confidence is `manual`
- **AND** all detected identity mismatches are returned as warnings

#### Scenario: Same request selected twice
- **WHEN** the base request ID equals the target request ID
- **THEN** the request fails with `BAD_REQUEST`
- **AND** no diff is computed

#### Scenario: Manual base does not exist
- **WHEN** the selected base request ID does not exist
- **THEN** the request fails with `PROXY_REQUEST_NOT_FOUND`

### Requirement: Category-level semantic diff
The system SHALL compare system instructions, conversation messages, tool definitions, and model/request parameters as separate categories. Every category SHALL report `added`, `removed`, `modified`, and `unchanged` counts plus ordered added/removed/modified entries linked to source paths. Unchanged items SHALL be counted but SHALL NOT be repeated as response entries.

#### Scenario: Tool schema changes between requests
- **WHEN** a tool with the same normalized name exists in both requests but its description or parameter schema differs
- **THEN** the tool is reported as `modified`
- **AND** the changed source paths and bounded before/after evidence are returned

#### Scenario: Message appended without earlier changes
- **WHEN** the target retains all base messages in the same order and appends one message
- **THEN** the retained messages count as unchanged
- **AND** only the appended message is reported as added

#### Scenario: System prompt removed
- **WHEN** a system instruction present in the base is absent from the target
- **THEN** the system category reports a removal
- **AND** the summary marks system-context loss

#### Scenario: Parameter type changes
- **WHEN** a compared parameter changes from one JSON type to another
- **THEN** the entry is reported as modified with both types preserved
- **AND** values are not coerced to strings for equality

### Requirement: Stable matching and canonical equality
The system SHALL use stable provider identifiers when present, otherwise canonical content hashes with occurrence ordinals, to match repeated messages and tools. Object key order SHALL NOT create a false modification, while array order and message order SHALL remain significant.

#### Scenario: JSON object key order differs
- **WHEN** two tool schemas contain equal JSON values but their object keys appear in a different order
- **THEN** the schemas are considered unchanged

#### Scenario: Duplicate identical messages
- **WHEN** a request contains the same normalized message content more than once
- **THEN** each occurrence remains independently matchable
- **AND** one removed occurrence does not remove all identical messages

#### Scenario: Message order changes
- **WHEN** equal messages appear in a different conversation order
- **THEN** the diff reports the order change or equivalent remove/add evidence
- **AND** the messages SHALL NOT be treated as an unordered set

### Requirement: Bounded inline text evidence
For modified textual evidence within the configured comparison limit, the system SHALL return ordered equal/added/removed segments suitable for character-level inline highlighting. Oversized text SHALL return hashes, lengths, bounded excerpts, and an explicit truncation reason instead of an unbounded payload.

#### Scenario: Small system prompt edit
- **WHEN** a system prompt modification is within the inline-diff limit
- **THEN** the response includes ordered equal, removed, and added segments
- **AND** the UI can render the exact changed text without fetching raw bodies

#### Scenario: Oversized tool schema
- **WHEN** a changed tool definition exceeds the inline-diff limit
- **THEN** the response includes before/after hashes, lengths, bounded excerpts, and `truncated=true`
- **AND** the total API response remains within the response budget

### Requirement: Context growth and token delta
The diff SHALL report base and target normalized character counts by category, total character delta, message-count delta, tool-count delta, and captured input-token delta when both requests contain input-token evidence. Character counts SHALL be labelled as measured text size, not billed tokens.

#### Scenario: Captured token evidence exists on both requests
- **WHEN** both proxy requests contain non-null input-token counts
- **THEN** the diff returns their numeric delta with provenance `captured_usage`

#### Scenario: Token evidence is incomplete
- **WHEN** either request lacks captured input-token counts
- **THEN** token delta is null with an unavailable reason
- **AND** character delta remains available

### Requirement: Compaction and truncation indicators
The system SHALL emit deterministic indicators for significant message-history shrinkage, system-instruction loss, tool-definition loss, and request-body truncation. These indicators SHALL be labelled as observations or suspected compaction, never as proof that a specific client compaction mechanism ran.

#### Scenario: History shrinks materially
- **WHEN** target conversation character count is at least 30 percent lower than a non-empty base and removed messages are present
- **THEN** the result includes `history_shrink` with severity and measured before/after values
- **AND** the label states `suspected_compaction`

#### Scenario: Body was not captured completely
- **WHEN** either source is known to be incomplete or a comparison cap omits content
- **THEN** the result includes `source_incomplete`
- **AND** no `no_change` conclusion is presented as complete evidence

### Requirement: Provenance and completeness
Every successful diff SHALL identify the base and target request IDs, capture methods, parser routes, normalized formats, capture-group IDs when present, parsed session IDs when present, body hashes, capture timestamps, pairing confidence, warnings, and per-category completeness.

#### Scenario: Capture formats differ
- **WHEN** a manual comparison uses two different supported normalized formats
- **THEN** both formats are disclosed
- **AND** categories that cannot be compared faithfully are marked incomplete rather than silently dropped

#### Scenario: No changes detected
- **WHEN** all normalized categories are equal and both sources are complete
- **THEN** the response reports `noChange=true`
- **AND** includes matching source hashes and complete category statuses

### Requirement: On-demand API behavior
The system SHALL expose context diff through `GET /api/proxy/requests/:id/context-diff`. Query parameter `base=previous` or omission SHALL request automatic pairing; a positive integer `base=<requestId>` SHALL request manual pairing. The route SHALL return the unified API error envelope for all non-2xx responses.

#### Scenario: Automatic diff succeeds
- **WHEN** a client requests context diff for a target with an eligible predecessor
- **THEN** the endpoint returns HTTP 200 with one bounded context-diff result

#### Scenario: Automatic pairing unavailable
- **WHEN** a client requests automatic context diff and no eligible predecessor exists
- **THEN** the endpoint returns HTTP 409 with `CONTEXT_DIFF_UNAVAILABLE`
- **AND** details include the stable reason `pairing_unavailable`

#### Scenario: Target request is unsupported
- **WHEN** the target exists but cannot be normalized from the desensitized body
- **THEN** the endpoint returns HTTP 422 with `CONTEXT_DIFF_UNSUPPORTED`
- **AND** details include the stable normalization reason

#### Scenario: Malformed base parameter
- **WHEN** `base` is neither `previous` nor a positive integer
- **THEN** the endpoint returns HTTP 400 with `BAD_REQUEST`

### Requirement: Performance and isolation
Context diff SHALL compare exactly two stored requests on demand and SHALL NOT run during proxy forwarding, list loading, session detail loading, application startup, or SSE handling. At the tier-B design ceiling, server processing SHALL complete within 100 ms p95, event-loop delay SHALL remain below 50 ms p99, and the uncompressed JSON response SHALL remain below 1 MiB.

#### Scenario: Capturing live traffic
- **WHEN** the proxy forwards and records a request
- **THEN** no semantic diff computation runs on the forwarding path
- **AND** existing proxy forwarding/desensitization budgets remain unchanged

#### Scenario: Large supported pair
- **WHEN** two source bodies reach the documented comparison cap
- **THEN** processing stops at deterministic bounds and returns truncation metadata
- **AND** server time, event-loop delay, and response size remain within budget

### Requirement: No false success
The system SHALL distinguish success with changes, success with no changes, unsupported input, unavailable pairing, incomplete evidence, and internal failure. Empty arrays or zero counts SHALL NOT be used to disguise unsupported or failed normalization.

#### Scenario: Parser throws unexpectedly
- **WHEN** normalization or diff raises an unclassified error
- **THEN** the endpoint returns HTTP 500 with `INTERNAL_ERROR`
- **AND** the response contains no request body, stack trace, secret, or partial diff
